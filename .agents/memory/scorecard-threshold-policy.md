---
name: Scorecard threshold policy
description: How company score bands affect new and historical analysis results
---

Company score thresholds define the current interpretation of every scored finding, including interactive score rings, persisted historical analyses, and regenerated PDFs; they are not only a display-color preference.

**Why:** A company changing its operating baseline expects the same score to carry the same meaning everywhere. Preserving old stored priorities would make history, spot-check summaries, and PDF headings contradict the active legend.

**How to apply:** Resolve the company bands with the legacy 70/40 fallback, then derive priority and color from each finding's numeric score when creating, retrieving, merging, rendering, or exporting results. Regenerated downloads must prefer the live company policy over a stored report snapshot. Preserve an existing priority only when no valid score is available.