import type { irtEn } from "./en"

/** IRT strings, Bangla. Same shape as en.ts. */
export const irtBn: typeof irtEn = {
  irt: {
    name: "রিপোর্টিং টুল",
    description: "রিপোর্ট ক্যাটালগ, বিল্ডার ও সময়সূচি",
    pages: {
      home: "রিপোর্ট ক্যাটালগ",
      run: "রিপোর্ট চালান",
      builder: "রিপোর্ট বিল্ডার",
      schedules: "সময়সূচি",
      history: "চালানোর ইতিহাস",
    },
    perm: {
      app_view: "রিপোর্টিং টুল খোলা",
      export: "রিপোর্ট রপ্তানি",
      builder_create: "রিপোর্ট তৈরি ও সংরক্ষণ",
      schedule_edit: "রিপোর্টের সময়সূচি",
    },
    events: {
      ReportSaved: "রিপোর্ট {name} সংরক্ষিত",
      ReportScheduled: "রিপোর্ট {name}-এর সময়সূচি নির্ধারিত",
      ReportEmailed: "রিপোর্ট {name} ইমেইল করা হয়েছে",
    },
  },
}
