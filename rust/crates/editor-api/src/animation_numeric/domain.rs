use super::interval::{Interval, bernstein_range};
use super::model::*;
use super::sample::{Curve, SOLVE_ITERATIONS, ValidatedChannel, bernstein, finite};
use super::tight::tight_range;

impl ValidatedChannel<'_> {
    /// Covers all finite f64 times in the closed domain, not just export frames.
    /// Callers must handle `Unresolved` separately from a successful certificate.
    pub fn check_closed_domain(
        &self,
        domain: ClosedDomain,
        bounds: NumericBounds,
        budget: CheckBudget,
    ) -> DomainCheck {
        if !domain.start.is_finite() || !domain.end.is_finite() || domain.start > domain.end {
            return unresolved(domain, IssueKind::InvalidDomain);
        }
        if !bounds.display_multiplier.is_finite()
            || bounds.min.is_some_and(|v| !v.is_finite())
            || bounds.max.is_some_and(|v| !v.is_finite())
            || matches!((bounds.min, bounds.max), (Some(a), Some(b)) if a > b)
        {
            return unresolved(domain, IssueKind::InvalidBounds);
        }
        let mut check = Check {
            bounds,
            budget,
            visited: 0,
            values: Interval {
                lo: f64::INFINITY,
                hi: f64::NEG_INFINITY,
            },
            displayed: Interval {
                lo: f64::INFINITY,
                hi: f64::NEG_INFINITY,
            },
        };
        match check.channel(self, domain) {
            Err(failure) => failure,
            Ok(()) => DomainCheck::Safe {
                values: ValueRange {
                    min: check.values.lo,
                    max: check.values.hi,
                },
                displayed: ValueRange {
                    min: check.displayed.lo,
                    max: check.displayed.hi,
                },
                visited_nodes: check.visited,
            },
        }
    }
}

fn unresolved(domain: ClosedDomain, kind: IssueKind) -> DomainCheck {
    DomainCheck::Unresolved {
        domain,
        issue: NumericIssue::new(kind, None),
        visited_nodes: 0,
    }
}

struct Check {
    bounds: NumericBounds,
    budget: CheckBudget,
    visited: u32,
    values: Interval,
    displayed: Interval,
}

impl Check {
    fn violation(&self, time: f64, value: Option<f64>, issue: NumericIssue) -> DomainCheck {
        DomainCheck::Violation {
            time,
            value,
            issue,
            visited_nodes: self.visited,
        }
    }

    fn include(&mut self, values: Interval, displayed: Interval) {
        self.values.lo = self.values.lo.min(values.lo);
        self.values.hi = self.values.hi.max(values.hi);
        self.displayed.lo = self.displayed.lo.min(displayed.lo);
        self.displayed.hi = self.displayed.hi.max(displayed.hi);
    }

    fn fits(&self, displayed: Interval) -> bool {
        displayed.finite()
            && self.bounds.min.is_none_or(|min| displayed.lo >= min)
            && self.bounds.max.is_none_or(|max| displayed.hi <= max)
    }

    fn exact(
        &mut self,
        time: f64,
        value: Result<f64, NumericIssue>,
        index: Option<usize>,
    ) -> Result<(), DomainCheck> {
        let value = value.map_err(|issue| self.violation(time, None, issue))?;
        let display = value * self.bounds.display_multiplier;
        if !display.is_finite() {
            return Err(self.violation(
                time,
                Some(value),
                NumericIssue::new(IssueKind::NonFiniteArithmetic, index),
            ));
        }
        if !self.fits(Interval::point(display)) {
            return Err(self.violation(
                time,
                Some(value),
                NumericIssue::new(IssueKind::OutsideBounds, index),
            ));
        }
        self.include(Interval::point(value), Interval::point(display));
        Ok(())
    }

    fn display_range(&self, values: Interval) -> Option<Interval> {
        match self.bounds.display_multiplier {
            0.0 => Some(Interval::point(0.0)),
            1.0 => Some(values),
            -1.0 => Some(Interval {
                lo: -values.hi,
                hi: -values.lo,
            }),
            multiplier => values.mul(Interval::point(multiplier)),
        }
    }

    fn channel(
        &mut self,
        channel: &ValidatedChannel<'_>,
        domain: ClosedDomain,
    ) -> Result<(), DomainCheck> {
        if channel.keys.len() <= 1 || domain.start == domain.end {
            return self.exact(domain.start, channel.sample(domain.start), None);
        }
        let first = channel.keys[0].time as f64;
        self.monotone(
            channel,
            ClosedDomain {
                start: domain.start,
                end: domain.end.min(first.next_down()),
            },
            Some(0),
        )?;
        for (index, key) in channel.keys.iter().enumerate() {
            let time = key.time as f64;
            if domain.start <= time && time <= domain.end {
                self.exact(time, Ok(key.value), Some(index))?;
            }
            let Some(right) = channel.keys.get(index + 1) else {
                break;
            };
            let interior = ClosedDomain {
                start: domain.start.max(time.next_up()),
                end: domain.end.min((right.time as f64).next_down()),
            };
            if interior.start > interior.end {
                continue;
            }
            if key.segment != Segment::Bezier {
                self.monotone(channel, interior, Some(index))?;
                continue;
            }
            // These are rejection witnesses only. Successful samples never
            // replace the interval/tree certificate below.
            self.exact(interior.start, channel.sample(interior.start), Some(index))?;
            self.exact(interior.end, channel.sample(interior.end), Some(index))?;
            let mid = interior.start / 2.0 + interior.end / 2.0;
            self.exact(mid, channel.sample(mid), Some(index))?;
            let curve = channel
                .curve(index)
                .map_err(|issue| self.violation(interior.start, None, issue))?;
            if let Some(value) = curve.constant() {
                self.exact(interior.start, Ok(value), Some(index))?;
            } else {
                self.bezier(&curve, index, interior, 0.0, 1.0, 0)?;
            }
        }
        let last = channel.keys.len() - 1;
        self.monotone(
            channel,
            ClosedDomain {
                start: domain.start.max((channel.keys[last].time as f64).next_up()),
                end: domain.end,
            },
            Some(last),
        )
    }

    // Each rounded operation of a step/hold, linear segment or linear edge is
    // monotone in time for finite fixed operands. Interior domains exclude exact
    // key fast paths, so endpoint checks also expose overflow in the formula.
    fn monotone(
        &mut self,
        channel: &ValidatedChannel<'_>,
        domain: ClosedDomain,
        index: Option<usize>,
    ) -> Result<(), DomainCheck> {
        if domain.start > domain.end {
            return Ok(());
        }
        self.exact(domain.start, channel.sample(domain.start), index)?;
        self.exact(domain.end, channel.sample(domain.end), index)
    }

    fn bezier(
        &mut self,
        curve: &Curve,
        index: usize,
        times: ClosedDomain,
        lower: f64,
        upper: f64,
        depth: u8,
    ) -> Result<(), DomainCheck> {
        if self.visited == self.budget.max_nodes {
            return Err(DomainCheck::Unresolved {
                domain: times,
                issue: NumericIssue::new(IssueKind::BudgetExhausted, Some(index)),
                visited_nodes: self.visited,
            });
        }
        self.visited += 1;
        let mid = (lower + upper) / 2.0;
        if depth == SOLVE_ITERATIONS {
            // All times reaching this leaf produce the same dyadic progress.
            return self.exact(
                times.start,
                finite(bernstein(mid, curve.y), index),
                Some(index),
            );
        }
        if let Some(values) = tight_range(lower, upper, curve.y) {
            if let Some(displayed) = self.display_range(values) {
                if self.fits(displayed) {
                    self.include(values, displayed);
                    return Ok(());
                }
            }
        }
        if let Some(values) = bernstein_range(
            Interval {
                lo: lower,
                hi: upper,
            },
            curve.y,
        ) {
            if values.finite() {
                if let Some(displayed) = self.display_range(values) {
                    if self.fits(displayed) {
                        self.include(values, displayed);
                        return Ok(());
                    }
                }
            }
        }
        let estimate = bernstein(mid, curve.x);
        // This mirrors `estimate < time` exactly. next_up represents the strict
        // branch over f64 times; no mathematical inverse or monotonic-x premise
        // is needed, even with crossed handles or rounded large absolute times.
        let left = ClosedDomain {
            start: times.start,
            end: times.end.min(estimate),
        };
        if left.start <= left.end {
            self.bezier(curve, index, left, lower, mid, depth + 1)?;
        }
        let right = ClosedDomain {
            start: times.start.max(estimate.next_up()),
            end: times.end,
        };
        if right.start <= right.end {
            self.bezier(curve, index, right, mid, upper, depth + 1)?;
        }
        Ok(())
    }
}
