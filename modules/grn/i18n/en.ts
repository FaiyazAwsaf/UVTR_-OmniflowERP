/** GRN strings, English. Every key also lives in bn.ts. */
export const grnEn = {
  grn: {
    name: "Goods Receive Note",
    description: "Receive against POs with QC and quarantine",
    pages: {
      home: "Awaiting goods",
      receive: "Receive goods",
      grn: "Goods receive note",
      quarantine: "Quarantine",
    },
    perm: {
      app_view: "Open Goods Receive Note",
      receive_create: "Receive goods",
      quarantine_decide: "Accept or return quarantined lots",
    },
    events: {
      GoodsReceived: "GRN {no}: {accepted} accepted",
      LotQuarantined: "Lot quarantined on {no}",
      QuarantineAccepted: "Quarantined lot accepted",
      QuarantineReturned: "Quarantined lot returned",
    },
  },
}
