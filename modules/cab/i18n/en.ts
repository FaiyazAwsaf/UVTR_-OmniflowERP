/** CAB strings, English. Every key also lives in bn.ts. */
export const cabEn = {
  cab: {
    name: "Cash & Bank Management",
    description: "Tills, banks, wallets, cheques and reconciliation",
    pages: {
      home: "Cash position",
      book: "Cash and bank book",
      transfers: "Transfers",
      cheques: "Cheques",
      reconciliation: "Reconciliation",
      pettyCash: "Petty cash",
      settlements: "Settlements",
    },
    perm: {
      app_view: "Open Cash & Bank",
      export: "Export cash and bank books",
      transfer_create: "Transfer funds and deposit tills",
      settlement_create: "Record card and MFS settlements",
      cheque_update: "Deposit, clear and bounce cheques",
      reconcile: "Reconcile bank statements",
      pettycash_create: "Spend and top up petty cash",
      pettycash_approve: "Approve petty cash vouchers",
      account_configure: "Configure cash and bank accounts",
    },
    events: {
      FundsTransferred: "Transfer {no}, {amount}",
      SettlementRecorded: "Settlement {no}, {amount}",
      ChequeDeposited: "Cheque {no} deposited",
      ChequeCleared: "Cheque {no} cleared",
      ChequeBounced: "Cheque {no} bounced",
      StatementImported: "Statement imported: {account}",
      StatementLineMatched: "Statement line matched",
      ReconciliationCompleted: "Reconciliation completed: {account}",
      PettyCashSpent: "Petty cash {no}, {amount}",
    },
  },
}
