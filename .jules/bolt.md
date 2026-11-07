## 2026-11-07 - [O(n^2) Render Optimization]
**Learning:** [React components rendering unbounded lists of elements (e.g. bounding boxes) can suffer severe performance degradation if metadata lookups during render use array scans like Array.prototype.find().]
**Action:** [Pre-compute a Map or Record dictionary (via useMemo) before mapping over large element collections to ensure O(1) metadata lookups per child element.]

## 2026-11-07 - [O(n log n) Sort and Date Parsing Optimization]
**Learning:** [Repeated execution of Date parsing strings (like `new Date(str)`) is extremely expensive and scales poorly when executed in loops such as array filters or sorting comparators. Furthermore, unnecessary evaluation of computationally heavy functions should be avoided inside loops if conditions permit early exits.]
**Action:** [Use module-level Map caching with size caps to memoize deterministic operations like timestamp parsing. Short-circuit expensive condition checks inside tight loops whenever a broader filter renders them unnecessary.]
