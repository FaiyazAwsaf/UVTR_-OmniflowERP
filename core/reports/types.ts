import type { OmniflowDb } from "@/core/db/database"
import type { ISODate } from "@/core/db/schema"

/**
 * Reporting datasets (plan §3.19). The main agent registers each dataset's
 * code and fields in core/reports/datasets.ts; each app fills its loaders in
 * modules/<app>/datasets.ts.
 */

export type DatasetFieldType = "text" | "number" | "money" | "date" | "enum"

export type DatasetField = {
  key: string
  /** i18n key of the column title */
  labelKey: string
  type: DatasetFieldType
  /** i18n key prefix for enum values (`${enumKeys}.${value}`) */
  enumKeys?: string
  groupable?: boolean
  filterable?: boolean
  /** Field holding a link target for drill-down (a route) */
  linkField?: string
}

/** Parameters every loader receives. */
export type DatasetParams = {
  from?: ISODate
  to?: ISODate
  locationId?: string
  /** Free filters by field key */
  [key: string]: unknown
}

export type DatasetRow = Record<string, string | number | null | undefined>

export type DatasetLoader = (db: OmniflowDb, params: DatasetParams) => Promise<DatasetRow[]>

/** Dataset code to its loader, per app module. */
export type DatasetLoaders = Record<string, DatasetLoader>

export type DatasetDef = {
  code: string
  /** i18n key of the dataset's name */
  labelKey: string
  app: string
  /** The date field the default range applies to */
  dateField?: string
  fields: DatasetField[]
}
