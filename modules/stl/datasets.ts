import type { DatasetLoaders } from "@/core/reports/types"

/**
 * STL report dataset loaders (implementation_plan.md §3.19.1), keyed by
 * dataset code. The datasets and their fields are registered in
 * core/reports/datasets.ts; the workstream fills the loaders.
 */
export const stlDatasetLoaders: DatasetLoaders = {}
