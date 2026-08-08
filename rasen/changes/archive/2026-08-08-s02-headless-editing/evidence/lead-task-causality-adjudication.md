# LEAD adjudication — pre-delivery verification causality

Task 12.8 originally required every new delta scenario to execute before task 13.1 could assign the ship leaf. The delta itself contains three necessarily later workflow scenarios: separate Luna ship, fresh LEAD integration, and archive after accepted spec sync. Requiring those scenarios before ship while also prohibiting ship before 12.8 is a dependency cycle, not a stronger quality gate.

The LEAD corrected only task 12.8's temporal predicate: all pre-delivery scenarios must execute and review must be clean, while the three delivery scenarios remain explicitly pending for tasks 13.1–13.10. Their acceptance wording and later evidence obligations are unchanged. This does not mark any task complete, does not promote a pending scenario, and does not authorize ship before a clean non-author review.

The third fresh Sol reviewer must audit this correction with the product delta. If any non-delivery scenario is failed or unverified, task 12.8 remains false. If the product is clean, the expected pre-ship scenario state is 59 PASS / 0 FAIL / 0 UNVERIFIED among pre-delivery scenarios plus 3 explicitly PENDING delivery scenarios.
