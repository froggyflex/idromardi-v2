type InvoicePrintCardProps = {
  r: any;
  logoUrl?: string;
  trimestreLabel?: string;
  dataLettura?: string;
};

function euro(v: any) {
  const value = Number(v ?? 0);
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function num(v: any) {
  return Number(v ?? 0);
}

export default function InvoicePrintCard({
  r,
  logoUrl,
  trimestreLabel,
  dataLettura,
}: InvoicePrintCardProps) {
  const nome = [r?.utenza?.Nome, r?.utenza?.Cognome].filter(Boolean).join(" ");
  const lettAtt = r?.riga?.lettura_attuale ?? r?.attuale?.valore_lettura ?? "";
  const lettPrec = r?.riga?.lettura_precedente ?? r?.precedente?.valore_lettura ?? "";
  const stato = r?.riga?.stato_attuale ?? r?.attuale?.stato_lettura ?? "";
  const consumo = num(r?.riga?.consumo_totale);
  const stornoTotale = Number(r?.riga?.storno_acconto || 0);
  const stornoTxt = Number(r?.riga?.storno_txt_aggiuntivo || 0);
  const stornoLegacy = Number(r?.riga?.storno_legacy || 0);
  const stornoPrecedente = Number((stornoTotale - stornoTxt - stornoLegacy).toFixed(2));

  return (
    <div className="invoice-card">
      <div className="invoice-header">
        <div>
          <div className="invoice-title">Bolletta di Ripartizione</div>
          <div className="invoice-subtitle">Copia per uso interno amministrativo</div>
        </div>

        <div className="invoice-logo">
          {logoUrl ? (
            <img src={logoUrl} alt="Idromardi" />
          ) : (
            <div className="invoice-logo-placeholder">IDROMARDI</div>
          )}
        </div>
      </div>

      <div className="invoice-section identity-grid">
        <div>
          <div className="label">ID</div>
          <div className="value">{r?.utenza?.id_user ?? "-"}</div>
        </div>
        <div>
          <div className="label">Utente</div>
          <div className="value">{nome || "-"}</div>
        </div>
        <div>
          <div className="label">Ubicazione</div>
          <div className="value">
            Is. {r?.utenza?.Isolato ?? "-"} · Sc. {r?.utenza?.Scala ?? "-"} · Int. {r?.utenza?.Interno ?? "-"}
          </div>
        </div>
      </div>

      <div className="invoice-section reading-grid">
        <div className="cell">
          <div className="label">Trim</div>
          <div className="value">{trimestreLabel ?? "-"}</div>
        </div>
        <div className="cell">
          <div className="label">Data Lett.</div>
          <div className="value">{dataLettura ?? "-"}</div>
        </div>
        <div className="cell">
          <div className="label">Lett. Prec</div>
          <div className="value">{lettPrec}</div>
        </div>
        <div className="cell">
          <div className="label">Lett. Att</div>
          <div className="value">{lettAtt}</div>
        </div>
        <div className="cell">
          <div className="label">Stato</div>
          <div className="value">{stato || "-"}</div>
        </div>
        <div className="cell highlight">
          <div className="label">Consumo</div>
          <div className="value">{consumo.toFixed(0)} mc</div>
        </div>
      </div>

      <div className="invoice-section cost-grid">
        <div className="cell"><div className="label">Acq</div><div className="value">€ {euro(r?.riga?.imp_acquedotto)}</div></div>
        <div className="cell"><div className="label">Fog</div><div className="value">€ {euro(r?.riga?.imp_fognatura)}</div></div>
        <div className="cell"><div className="label">Dep</div><div className="value">€ {euro(r?.riga?.imp_depurazione)}</div></div>
        <div className="cell"><div className="label">QF</div><div className="value">€ {euro(r?.riga?.imp_qf)}</div></div>
        <div className="cell"><div className="label">Cong.</div><div className="value">€ {euro(r?.riga?.conguaglio)}</div></div>
        <div className="cell"><div className="label">Oneri</div><div className="value">€ {euro(r?.riga?.imp_oneri_base_display ?? r?.riga?.imp_oneri)}</div></div>
        <div className="cell"><div className="label">Oneri pereq.</div><div className="value">€ {euro(r?.riga?.imp_oneri_perequazione_display)}</div></div>
        <div className="cell"><div className="label">IVA</div><div className="value">€ {euro(r?.riga?.imp_iva)}</div></div>
        <div className="cell"><div className="label">Acconto Acquedotto mc</div><div className="value font-normal">{euro(r?.riga?.consumo_acconto)} mc</div></div>
        <div className="cell"><div className="label">Acconto Acquedotto €</div><div className="value font-normal">€ {euro(r?.riga?.imp_acconto)}</div></div>
        <div className="cell"><div className="label">Storno TXT</div><div className="value">€ {euro(stornoTxt)}</div></div>
        <div className="cell"><div className="label">Storno precedente</div><div className="value">€ {euro(stornoLegacy + stornoPrecedente)}</div></div>
        <div className="cell"><div className="label">Arr.</div><div className="value">€ {euro(r?.riga?.imp_arr)}</div></div>
      </div>

      <div className="invoice-total">Totale: € {euro(r?.riga?.totale)}</div>

      <div className="invoice-footer">
        <div>
          Legenda: K = lett. verificata · U = lett. utente · T = tel. utente · F = foto cont. ·
          I = internet · L = cartolina · S = contatore sostituito · X = cons. presunto ·
          Y = cont. illeg. o fermo · C = disabitato
        </div>
        <div className="company-line">
          Idromardi · Via Posillipo, 299 · 80123 Napoli · info@idromardi.it · www.idromardi.it
        </div>
      </div>
    </div>
  );
}
