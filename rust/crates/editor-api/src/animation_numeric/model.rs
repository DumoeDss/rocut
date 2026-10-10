pub const MAX_SAFE_TICKS: u64 = 9_007_199_254_740_991;
pub const MAX_CHECK_NODES: u32 = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Segment {
    Step,
    Linear,
    Bezier,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Extrapolation {
    Hold,
    Linear,
}

#[derive(Clone, Copy, Debug)]
pub struct Handle {
    pub dt: i64,
    pub dv: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ScalarKey {
    pub time: u64,
    pub value: f64,
    pub segment: Segment,
    pub left: Option<Handle>,
    pub right: Option<Handle>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClosedDomain {
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct NumericBounds {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub display_multiplier: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct CheckBudget {
    pub(crate) max_nodes: u32,
}

impl CheckBudget {
    pub fn new(max_nodes: u32) -> Result<Self, NumericIssue> {
        if max_nodes > MAX_CHECK_NODES {
            return Err(NumericIssue::new(IssueKind::InvalidBudget, None));
        }
        Ok(Self { max_nodes })
    }
}

impl Default for CheckBudget {
    fn default() -> Self {
        Self { max_nodes: 4096 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IssueKind {
    InvalidKeyTime,
    UnorderedKeys,
    InvalidHandle,
    NonFiniteInput,
    NonFiniteTime,
    NonFiniteArithmetic,
    InvalidDomain,
    InvalidBounds,
    OutsideBounds,
    InvalidBudget,
    BudgetExhausted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NumericIssue {
    pub kind: IssueKind,
    pub key_index: Option<usize>,
}

impl NumericIssue {
    pub(crate) fn new(kind: IssueKind, key_index: Option<usize>) -> Self {
        Self { kind, key_index }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ValueRange {
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DomainCheck {
    Safe {
        values: ValueRange,
        displayed: ValueRange,
        visited_nodes: u32,
    },
    Violation {
        time: f64,
        value: Option<f64>,
        issue: NumericIssue,
        visited_nodes: u32,
    },
    Unresolved {
        domain: ClosedDomain,
        issue: NumericIssue,
        visited_nodes: u32,
    },
}
