  const summaryCards = [
    {
      key: "proforma",
      eyebrow: "INSOLUTI",
      title: "Totale insoluto PROFORMA",
      amount: "€ 34,85",
      accent: "from-blue-700 to-blue-600",
      border: "border-blue-500",
      text: "text-blue-700",
      soft: "bg-blue-50",
      icon: "📄",
    },
    {
      key: "fatture",
      eyebrow: "INSOLUTI",
      title: "Totale insoluto FATTURE",
      amount: "€ 0,00",
      accent: "from-fuchsia-800 to-purple-700",
      border: "border-fuchsia-500",
      text: "text-fuchsia-700",
      soft: "bg-fuchsia-50",
      icon: "🧾",
    },
    {
      key: "incassato",
      eyebrow: "FATTURATO",
      title: "Totale INCASSATO",
      amount: "€ 44,00",
      accent: "from-lime-600 to-green-600",
      border: "border-lime-500",
      text: "text-lime-700",
      soft: "bg-lime-50",
      icon: "€",
    },
  ];

  const quickActions = [
    {
      title: "Nuova proforma",
      description: "Inserimento manuale di una proforma singola.",
      badge: "Manuale",
    },
    {
      title: "Nuova fattura",
      description: "Inserimento manuale di una fattura singola.",
      badge: "Manuale",
    },
    {
      title: "Carica batch proforme",
      description: "Upload multiplo file per parser proforma.",
      badge: "Batch upload",
    },
    {
      title: "Carica batch fatture",
      description: "Upload multiplo file per parser fatture.",
      badge: "Batch upload",
    },
  ];

  const recentRows = [
    {
      type: "Proforma",
      number: "PF-2026-00124",
      condominio: "Condominio Via Roma 12",
      customer: "Mario Rossi",
      source: "Upload parser",
      status: "Da verificare",
      amount: "€ 34,85",
      date: "28/03/2026",
    },
    {
      type: "Fattura",
      number: "FT-2026-00077",
      condominio: "Residenza Atena",
      customer: "Anna Bianchi",
      source: "Manuale",
      status: "Confermata",
      amount: "€ 44,00",
      date: "27/03/2026",
    },
    {
      type: "Fattura",
      number: "FT-2026-00076",
      condominio: "Residence Mare Blu",
      customer: "Luca Verdi",
      source: "Upload parser",
      status: "Incassata",
      amount: "€ 120,00",
      date: "25/03/2026",
    },
  ];

  const statusClass  = {
    "Da verificare": "bg-amber-50 text-amber-700 ring-amber-200",
    Confermata: "bg-sky-50 text-sky-700 ring-sky-200",
    Incassata: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };

  Module.exports = {
    summaryCards,
    quickActions,
    recentRows,
    statusClass
  };