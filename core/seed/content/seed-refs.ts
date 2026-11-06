/**
 * Fixed ids of the records launchers, tests and the demo story refer to by
 * name (seed_data.md §0, §9). Everything else the seed creates may vary with
 * the date; tests find it by role or by one of these ids, never by an id
 * seen once.
 */

/* ---------------- Organisation ---------------- */

export const LOC = {
  HQ: "loc_hq",
  GUL: "loc_gul",
  UTT: "loc_utt",
  CST: "loc_cst",
} as const

export const CC = {
  HQ: "cc_hq",
  GUL: "cc_gul",
  UTT: "cc_utt",
  CST: "cc_cst",
} as const

export const BAY = {
  GUL_W1: "bay_gul_w1",
  GUL_W2: "bay_gul_w2",
  GUL_D1: "bay_gul_d1",
  GUL_D2: "bay_gul_d2",
  GUL_D3: "bay_gul_d3",
  GUL_C1: "bay_gul_c1",
  UTT_W1: "bay_utt_w1",
  UTT_D1: "bay_utt_d1",
  UTT_D2: "bay_utt_d2",
  UTT_C1: "bay_utt_c1",
} as const

export const USR = {
  rashed: "usr_rashed",
  farzana: "usr_farzana",
  mahbub: "usr_mahbub",
  shahriar: "usr_shahriar",
  arif: "usr_arif",
  nayeem: "usr_nayeem",
  shuvo: "usr_shuvo",
  tania: "usr_tania",
  sabbir: "usr_sabbir",
  rakib: "usr_rakib",
  sajib: "usr_sajib",
  monir: "usr_monir",
  faruk: "usr_faruk",
  sohel: "usr_sohel",
  jewel: "usr_jewel",
  polash: "usr_polash",
  kamrul: "usr_kamrul",
  habib: "usr_habib",
  nusrat: "usr_nusrat",
  tahmid: "usr_tahmid",
  shamima: "usr_shamima",
} as const

/* ---------------- Cash and bank (foundation ids) ---------------- */

export const CBA = {
  TILL_GUL: "cba_till_gul",
  TILL_UTT: "cba_till_utt",
  PETTY_HQ: "cba_petty_hq",
  PETTY_GUL: "cba_petty_gul",
  PETTY_UTT: "cba_petty_utt",
  BRAC: "cba_brac",
  DBBL: "cba_dbbl",
  BKASH: "cba_bkash",
  NAGAD: "cba_nagad",
  CARD: "cba_card",
} as const

/* ---------------- Parties ---------------- */

/** Customers the story names (seed_data.md §5.2, §9). */
export const PTY = {
  walkIn: "pty_walk_in",
  shahedKabir: "pty_shahed_kabir",
  e1Customer: "pty_e1_customer",
  swiftRide: "pty_swift_ride",
  greenway: "pty_greenway",
  metroFleet: "pty_metro_fleet",
  orbit: "pty_orbit",
  bluebird: "pty_bluebird",
  skyline: "pty_skyline",
  primeAuto: "pty_prime_auto",
  wheelsHub: "pty_wheels_hub",
  gearbox: "pty_gearbox",
  autoNest: "pty_auto_nest",
} as const

/** The 14 vendors (seed_data.md §5.3). */
export const VND = {
  dhakaAutochem: "pty_dhaka_autochem",
  glossGuard: "pty_gloss_guard",
  bengalDetail: "pty_bengal_detail",
  northline: "pty_northline",
  metroChem: "pty_metro_chem",
  shaplaPack: "pty_shapla_pack",
  gulshanProps: "pty_gulshan_props",
  uttaraEstate: "pty_uttara_estate",
  tejgaonWh: "pty_tejgaon_wh",
  primeGuard: "pty_prime_guard",
  protech: "pty_protech",
  swiftlink: "pty_swiftlink",
  cityUtilities: "pty_city_utilities",
  rahmanAssoc: "pty_rahman_assoc",
} as const

export const CREDIT_CUSTOMER_IDS = [
  PTY.swiftRide,
  PTY.greenway,
  PTY.metroFleet,
  PTY.orbit,
  PTY.bluebird,
  PTY.skyline,
  PTY.primeAuto,
  PTY.wheelsHub,
  PTY.gearbox,
  PTY.autoNest,
] as const

export const VENDOR_IDS = Object.values(VND)

export const VEH = {
  /** Shahed Kabir's Toyota Corolla Cross, DHAKA METRO-GHA 15-7731 (J1 to J6) */
  corollaCross7731: "veh_corolla_cross_7731",
  /** E1 customer's Toyota Allion (Uttara) */
  e1Allion: "veh_e1_allion",
} as const

/* ---------------- Catalogue ---------------- */

export const ITM = {
  snowFoam: "itm_snow_foam",
  shampoo: "itm_shampoo",
  apc: "itm_apc",
  glassCleaner: "itm_glass_cleaner",
  tyreShine: "itm_tyre_shine",
  interiorDetailer: "itm_interior_detailer",
  fabricShampoo: "itm_fabric_shampoo",
  leatherCleaner: "itm_leather_cleaner",
  leatherConditioner: "itm_leather_conditioner",
  odour: "itm_odour",
  ironRemover: "itm_iron_remover",
  tarRemover: "itm_tar_remover",
  clayLube: "itm_clay_lube",
  compound: "itm_compound",
  polish: "itm_polish",
  ipa: "itm_ipa",
  wax: "itm_wax",
  sealant: "itm_sealant",
  /** CH-CC2-50 Ceramic coating, 2-year (50 ml kit) */
  cc2Kit: "itm_cc2_kit",
  /** CH-CC5-50 Ceramic coating, 5-year (50 ml kit) */
  cc5Kit: "itm_cc5_kit",
  glassPolish: "itm_glass_polish",
  glassCoating: "itm_glass_coating",
  wheelCleaner: "itm_wheel_cleaner",
  wheelCoating: "itm_wheel_coating",
  engineDressing: "itm_engine_dressing",
  uvSealant: "itm_uv_sealant",
  trimRestorer: "itm_trim_restorer",
  microfiber: "itm_microfiber",
  applicator: "itm_applicator",
  clayBar: "itm_clay_bar",
  cuttingPad: "itm_cutting_pad",
  polishingPad: "itm_polishing_pad",
  maskingTape: "itm_masking_tape",
  sandingDisc: "itm_sanding_disc",
  brush: "itm_brush",
  gloves: "itm_gloves",
  rtAfrOcean: "itm_rt_afr_ocean",
  rtAfrCitrus: "itm_rt_afr_citrus",
  rtAfrVanilla: "itm_rt_afr_vanilla",
  rtShampoo: "itm_rt_shampoo",
  rtTyreShine: "itm_rt_tyre_shine",
  rtGlassCleaner: "itm_rt_glass_cleaner",
  rtMicrofiber: "itm_rt_microfiber",
  rtDashPolish: "itm_rt_dash_polish",
  rtQuickDetailer: "itm_rt_quick_detailer",
  rtGiftKit: "itm_rt_gift_kit",
  rtWashMitt: "itm_rt_wash_mitt",
  rtWipes: "itm_rt_wipes",
  snowFoam20l: "itm_snow_foam_20l",
  shampoo20l: "itm_shampoo_20l",
  apc20l: "itm_apc_20l",
  apc1l: "itm_apc_1l",
  glassCleaner1l: "itm_glass_cleaner_1l",
  tyreShine1l: "itm_tyre_shine_1l",
  interiorDetailer1l: "itm_interior_detailer_1l",
  ironRemover1l: "itm_iron_remover_1l",
  ipa20l: "itm_ipa_20l",
  wheelCleaner1l: "itm_wheel_cleaner_1l",
  cc2Kit30: "itm_cc2_kit_30",
  cc5Kit30: "itm_cc5_kit_30",
} as const

export const CAT = {
  CHEM: "cat_chem",
  CONS: "cat_cons",
  RETAIL: "cat_retail",
} as const

/** Service ids: svc_<code in lower case, dash to underscore> (svc_prt_cc2). */
export const SVC = {
  WSH_EXP: "svc_wsh_exp",
  WSH_PRM: "svc_wsh_prm",
  INT_DEEP: "svc_int_deep",
  INT_LTH: "svc_int_lth",
  INT_ODR: "svc_int_odr",
  PNT_DCN: "svc_pnt_dcn",
  PNT_C1: "svc_pnt_c1",
  PNT_C2: "svc_pnt_c2",
  PRT_WAX: "svc_prt_wax",
  PRT_SLN: "svc_prt_sln",
  PRT_CC2: "svc_prt_cc2",
  PRT_CC5: "svc_prt_cc5",
  GLS_CLN: "svc_gls_cln",
  WHL_CLN: "svc_whl_cln",
  WHL_CC: "svc_whl_cc",
  ENG_BAY: "svc_eng_bay",
  RST_HL: "svc_rst_hl",
  RST_TRM: "svc_rst_trm",
} as const

export const PKG = {
  SHOW: "pkg_show",
  NEW: "pkg_new",
  FRESH: "pkg_fresh",
} as const

export const ADDON = {
  PET: "add_pet_hair",
  MUD: "add_heavy_mud",
  ENG: "add_engine_bay",
  PICKUP: "add_pickup_drop",
} as const

export const PL = {
  retail: "pl_retail",
  fleet: "pl_fleet",
  dealer: "pl_dealer",
  /** Draft RETAIL revision (wash prices +10% from the 1st of next month) */
  retailDraft: "pl_retail_draft",
} as const

export const PROMO = {
  winter10: "prm_winter10",
  firstcoat: "prm_firstcoat",
} as const

/* ---------------- Recurring templates ---------------- */

export const REC = {
  depreciation: "rec_depreciation",
  salary: "rec_salary_accrual",
  prepaid: "rec_prepaid_amortisation",
} as const

/* ---------------- Planted documents (seed_data.md §8, §9) ---------------- */

export const PLANT = {
  /** §8: PO of about ৳1,48,000 by Nusrat, above her ৳1,00,000 (pending, dated today) */
  pendingPo: "po_pending_nusrat",
  pendingPoApproval: "apv_pending_po",
  /** §8: petty cash voucher of ৳3,500 by Tania at Gulshan (pending, today) */
  pendingPettyCash: "pcv_pending_tania",
  pendingPettyCashApproval: "apv_pending_pcv",
  /** §8: stock adjustment at Uttara by Habib, damaged polish (pending, today) */
  pendingAdjustment: "adj_pending_habib",
  pendingAdjustmentApproval: "apv_pending_adj",
  /** §8: bill on hold from Dhaka Auto Chem, unit price 4% over the PO (today) */
  heldBill: "bl_held_dhaka_autochem",
  heldBillApproval: "apv_held_bill",
  heldBillPo: "po_held_bill",
  heldBillGrn: "grn_held_bill",
  /** E6: Prime Guard's most recent monthly bill, today − 13, posted and unpaid */
  e6Bill: "bl_e6_prime_guard",
  /** E8: Metro Corporate Fleet's PDC ৳85,000 dated today, in hand, receipt pending */
  e8Cheque: "chq_e8_metro",
  e8Receipt: "mr_e8_metro",
  /** Greenway's PDC ৳40,000 dated today + 3, in hand */
  greenwayCheque: "chq_greenway_pdc",
  greenwayReceipt: "mr_greenway_pdc",
  /** E12: paid retail invoice 3 days ago (premium wash + interior deep, SUV) */
  e12Invoice: "inv_e12",
  e12Order: "so_e12",
  /** Bengal Detail PO: 40 polishing pads, 24 received */
  bengalPartialPo: "po_bengal_partial",
  bengalPartialGrn: "grn_bengal_partial",
  /** E3: the booked SUV ceramic 2-year job today in Uttara's C1 */
  e3Order: "so_e3_uttara",
  /** Orbit's invoice 74 days past due (the reason it is on hold) */
  orbitOverdueInvoice: "inv_orbit_overdue",
  /** Swift Ride's three open invoices, dated 70, 45 and 20 days ago */
  swiftInvoice70: "inv_swift_70",
  swiftInvoice45: "inv_swift_45",
  swiftInvoice20: "inv_swift_20",
  /** Shahed Kabir's two past orders */
  shahedOrder1: "so_shahed_1",
  shahedOrder2: "so_shahed_2",
  /** Ceramic or paint job continuing from yesterday in Gulshan's D3 */
  gulD3Order: "so_gul_d3_continuing",
  /** A transfer dispatched this morning, not yet received (in transit) */
  inTransitTransfer: "trf_in_transit",
  /** Rashed's session from another device yesterday, ended by timeout */
  rashedTimeoutSession: "ses_rashed_timeout",
} as const

/** The four pending approvals of §8, all dated today. */
export const PENDING_APPROVAL_IDS = [
  PLANT.pendingPoApproval,
  PLANT.pendingPettyCashApproval,
  PLANT.pendingAdjustmentApproval,
  PLANT.heldBillApproval,
] as const
