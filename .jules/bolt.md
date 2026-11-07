## 2026-11-07 - [O(n^2) Render Optimization]
**Learning:** [React components rendering unbounded lists of elements (e.g. bounding boxes) can suffer severe performance degradation if metadata lookups during render use array scans like Array.prototype.find().]
**Action:** [Pre-compute a Map or Record dictionary (via useMemo) before mapping over large element collections to ensure O(1) metadata lookups per child element.]
