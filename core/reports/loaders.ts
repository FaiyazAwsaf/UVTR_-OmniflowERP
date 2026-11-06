import type { DatasetLoaders } from "./types"
import { faDatasetLoaders } from "@/modules/fa/datasets"
import { apDatasetLoaders } from "@/modules/ap/datasets"
import { arDatasetLoaders } from "@/modules/ar/datasets"
import { cabDatasetLoaders } from "@/modules/cab/datasets"
import { parDatasetLoaders } from "@/modules/par/datasets"
import { frsDatasetLoaders } from "@/modules/frs/datasets"
import { stlDatasetLoaders } from "@/modules/stl/datasets"
import { siDatasetLoaders } from "@/modules/si/datasets"
import { pcDatasetLoaders } from "@/modules/pc/datasets"
import { sdDatasetLoaders } from "@/modules/sd/datasets"
import { ptlDatasetLoaders } from "@/modules/ptl/datasets"
import { pmDatasetLoaders } from "@/modules/pm/datasets"
import { grnDatasetLoaders } from "@/modules/grn/datasets"
import { stDatasetLoaders } from "@/modules/st/datasets"
import { icDatasetLoaders } from "@/modules/ic/datasets"
import { irtDatasetLoaders } from "@/modules/irt/datasets"
import { sacDatasetLoaders } from "@/modules/sac/datasets"
import { rbacDatasetLoaders } from "@/modules/rbac/datasets"
import { dashboardDatasetLoaders } from "@/modules/dashboard/datasets"

/** Every app's dataset loaders, by dataset code. Only the main agent edits this file. */
export const DATASET_LOADERS: DatasetLoaders = {
  ...faDatasetLoaders,
  ...apDatasetLoaders,
  ...arDatasetLoaders,
  ...cabDatasetLoaders,
  ...parDatasetLoaders,
  ...frsDatasetLoaders,
  ...stlDatasetLoaders,
  ...siDatasetLoaders,
  ...pcDatasetLoaders,
  ...sdDatasetLoaders,
  ...ptlDatasetLoaders,
  ...pmDatasetLoaders,
  ...grnDatasetLoaders,
  ...stDatasetLoaders,
  ...icDatasetLoaders,
  ...irtDatasetLoaders,
  ...sacDatasetLoaders,
  ...rbacDatasetLoaders,
  ...dashboardDatasetLoaders,
}
