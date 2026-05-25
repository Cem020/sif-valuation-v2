import React, { useState, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList, ReferenceLine, RadialBarChart, RadialBar,
} from 'recharts';
import {
  AlertTriangle, TrendingUp, TrendingDown, Info,
  RotateCcw, Download, Target, Shield, Activity,
  FileText, Sliders, Grid3x3, Layers, ArrowRight, Minus,
  Flame, Zap, BookOpen,
} from 'lucide-react';

/* ============================================================================
   SHELL IMPACT FUND — CLA FAIR VALUE DASHBOARD · v5
   Translated from SIF_CLA_Fair_Value_Model_v5.xlsx (Q1 2026 refresh)
   ----------------------------------------------------------------------------
   Method: Probability-Weighted Expected Present Value (PWEV)
   FV per CLA = P(repay)·PV(repay) + P(convert)·PV(conv) + P(default)·PV(recovery)
   Transfer-adjusted FV = FV × (1 − illiquidity discount)
   ============================================================================ */

// ---------------------------------------------------------------------------
// 1. BASE DATA — exact values from SIF_CLA_Fair_Value_Model_v5.xlsx
// ---------------------------------------------------------------------------
const BASE_GLOBAL = {
  principal: 250000,
  pikRate: 0.05,
  maturityYears: 3,
  stdConvDiscount: 0.15,
  impactConvDiscount: 0.05,
  numCLAs: 5,
  discountRate: 0.15,
  recoveryRate: 0.05,
  illiquidityDiscount: 0.30,
  uniformProb: false,
  uniformPConvert: 0.45,
  uniformPRepay: 0.35,
  uniformPDefault: 0.20,
  downsideExitMult: 0.4,
  downsideDefUplift: 0.2,
  upsideExitMult: 1.8,
  upsideDefUplift: -0.1,
};

const BASE_COMPANIES = [
  {
    id: 1, name: 'Homii', sector: 'PropTech SaaS · Housing',
    stage: 'Q1 2026: €425k Gross Rev (annualised €1.7M), €72k cash, 70k HH reached. Reporting gaps in 2025.',
    pConvert: 0.03, pRepay: 0.85, pDefault: 0.12,
    expectedValuation: 7_800_000, conversionRoundValuation: 3_500_000,
    yearsToResolution: 1.5, impactMet: false,
    rationale: 'Management confirmed intent to REPAY. P(default) raised to 12% to reflect €72k low cash and the 2025 quarterly-reporting discipline gap. Repayment is the dominant outcome.',
    method: 'PropTech 6.5x ARR (annualised Q1)',
    keyMetric: '€1.7M annualised ARR',
    runway: 'Tight (€72k cash)',
    momentum: 'positive',
  },
  {
    id: 2, name: 'Fynch', sector: 'Mobility SaaS · Behavioural change',
    stage: 'Q1 2026: €95k revenue (−19% QoQ), €141k cash, 6.8m runway, BCD/Volvo B2B contracts.',
    pConvert: 0.25, pRepay: 0.20, pDefault: 0.55,
    expectedValuation: 1_674_568, conversionRoundValuation: 4_000_000,
    yearsToResolution: 2, impactMet: true,
    rationale: 'Q1 revenue DECLINED −19% QoQ (€117k → €95k). Declining SaaS revenue at this stage is a serious red flag. P(default) realistic at 55%. No active Series A signal in reporting.',
    method: '5.5x revenue + €100k contract-visibility premium',
    keyMetric: '−19% QoQ revenue',
    runway: '6.8 months',
    momentum: 'negative',
  },
  {
    id: 3, name: 'Newton', sector: 'Cleantech hardware · Residential energy',
    stage: 'Q1 2026: €249k revenue (+142% QoQ), €162k cash, 1.16m runway CRITICAL, €5–6M Series A target.',
    pConvert: 0.20, pRepay: 0.05, pDefault: 0.75,
    expectedValuation: 2_750_000, conversionRoundValuation: 5_500_000,
    yearsToResolution: 1.5, impactMet: false,
    rationale: '1.16 months runway at €140k/m burn vs €50k/m net revenue. Series A close MUST happen in next 4–6 weeks for survival. P(default) 75% reflects realistic odds. P(convert) only 20% if Series A closes.',
    method: 'Series A target €5.5M × 65% (35% haircut)',
    keyMetric: '+142% QoQ revenue',
    runway: '1.16 months — critical',
    momentum: 'mixed',
  },
  {
    id: 4, name: 'Rator', sector: 'Cleantech hardware · Pre-revenue',
    stage: 'Q1 2026: €0 revenue (pre-MVP), €244k cash, 9.8m runway, V4 prototype launch April 2026.',
    pConvert: 0.15, pRepay: 0.10, pDefault: 0.75,
    expectedValuation: 1_785_000, conversionRoundValuation: 1_500_000,
    yearsToResolution: 2.5, impactMet: false,
    rationale: 'Pre-revenue, pre-MVP (V4 prototype not yet launched). Needs to launch product AND raise €400k. P(default) 75% reflects realistic odds for pre-MVP cleantech hardware.',
    method: 'Pre-seed anchor €5.1M × 50% (pre-revenue discount)',
    keyMetric: 'Pre-revenue · pre-MVP',
    runway: '9.8 months',
    momentum: 'mixed',
  },
  {
    id: 5, name: 'Prets', sector: 'Vertical SaaS · Installer platform',
    stage: 'Q1 2026: €20.6k revenue (+140% QoQ), €25k cash CRITICAL, 9m runway, Sollit/Warmtefonds.',
    pConvert: 0.30, pRepay: 0.10, pDefault: 0.60,
    expectedValuation: 1_004_278, conversionRoundValuation: 2_500_000,
    yearsToResolution: 2, impactMet: true,
    rationale: 'Strong commercial trajectory (+140% QoQ) but €25k cash is critically thin. Recent €152k raise barely covered runway. P(convert) 30% reflects commercial promise; P(default) 60% reflects cash crisis.',
    method: '9.0x revenue + €300k distribution-access premium',
    keyMetric: '+140% QoQ revenue',
    runway: '9 months · €25k cash',
    momentum: 'positive',
  },
];

// ---------------------------------------------------------------------------
// 2. CALCULATION ENGINE (matches Excel Valuation Engine logic exactly)
// ---------------------------------------------------------------------------
const loanFutureValue = (P, pik, t) => P * Math.pow(1 + pik, t);
const discountFactor  = (r, t)      => 1 / Math.pow(1 + r, t);

function computeCompanyFV(c, g) {
  const u = g.uniformProb;
  const pC = u ? g.uniformPConvert : c.pConvert;
  const pR = u ? g.uniformPRepay   : c.pRepay;
  const pD = u ? g.uniformPDefault : c.pDefault;
  const t = c.yearsToResolution;
  const loanFV = loanFutureValue(g.principal, g.pikRate, t);
  const convDisc = c.impactMet ? g.impactConvDiscount : g.stdConvDiscount;
  const uplift = c.expectedValuation / c.conversionRoundValuation;
  const convValue = (loanFV / (1 - convDisc)) * uplift;
  const repayValue = loanFV;
  const recoveryValue = g.principal * g.recoveryRate;
  const df = discountFactor(g.discountRate, t);
  const pvConv = pC * convValue * df;
  const pvRepay = pR * repayValue * df;
  const pvDefault = pD * recoveryValue * df;
  const fairValue = pvConv + pvRepay + pvDefault;
  return { pC, pR, pD, loanFV, convDisc, uplift, convValue, repayValue, recoveryValue, df, pvConv, pvRepay, pvDefault, fairValue };
}

function computePortfolio(companies, g) {
  const rows = companies.map(c => ({ ...c, ...computeCompanyFV(c, g) }));
  const totalFV = rows.reduce((s, r) => s + r.fairValue, 0);
  const totalPrincipal = g.principal * companies.length;
  const totalPvConv = rows.reduce((s, r) => s + r.pvConv, 0);
  const totalPvRepay = rows.reduce((s, r) => s + r.pvRepay, 0);
  const totalPvDefault = rows.reduce((s, r) => s + r.pvDefault, 0);
  const avgPC = rows.reduce((s, r) => s + r.pC, 0) / rows.length;
  const avgPR = rows.reduce((s, r) => s + r.pR, 0) / rows.length;
  const avgPD = rows.reduce((s, r) => s + r.pD, 0) / rows.length;
  const top = [...rows].sort((a, b) => b.fairValue - a.fairValue)[0];
  const riskiest = [...rows].sort((a, b) => b.pD - a.pD)[0];
  return {
    rows, totalFV, totalPrincipal, totalPvConv, totalPvRepay, totalPvDefault,
    avgPC, avgPR, avgPD, top, riskiest,
    fvPctPrincipal: totalFV / totalPrincipal,
    transferAdjustedFV: totalFV * (1 - g.illiquidityDiscount),
  };
}

function applyScenario(companies, exitMult, defUplift) {
  return companies.map(c => ({
    ...c,
    pConvert: Math.min(1, Math.max(0, c.pConvert - defUplift)),
    pDefault: Math.min(1, Math.max(0, c.pDefault + defUplift)),
    expectedValuation: c.expectedValuation * exitMult,
  }));
}

// ---------------------------------------------------------------------------
// 3. FORMATTERS
// ---------------------------------------------------------------------------
const fmtEUR = n => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const fmtEURk = n => {
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `€${(n / 1_000).toFixed(0)}k`;
  return fmtEUR(n);
};
const fmtPct  = (n, d = 1) => `${(n * 100).toFixed(d)}%`;
const fmtMult = n => `${n.toFixed(2)}×`;

// ---------------------------------------------------------------------------
// 4. DESIGN SYSTEM
// ---------------------------------------------------------------------------
// Editorial finance palette: deep ink, parchment cream, signal accents
const C = {
  ink:      '#0B1F2A',   // primary text — near-black with teal undertone
  ink2:     '#2A3F4B',
  mute:     '#6B7A82',
  paper:    '#FAF7F1',   // warm off-white background
  card:     '#FFFFFF',
  rule:     '#E5DDD0',   // hairline divider, parchment-toned
  ruleSoft: '#EFE9DE',
  fv:       '#0A6E5A',   // primary "value" green — deep, not bright
  fvSoft:   '#E8F2EE',
  fvDark:   '#054238',
  warn:     '#B45309',
  warnSoft: '#FBF3E4',
  danger:   '#9C2B2B',
  dangerSoft: '#F9EBEB',
  accent:   '#C9A961',   // antique gold — for editorial flourishes
  conv:     '#0E5F7E',   // muted teal-blue
  repay:    '#0A6E5A',   // value-green
  def:      '#9C2B2B',
};

const COLORS = { conv: C.conv, repay: C.repay, def: C.def };

// ---------------------------------------------------------------------------
// 5. UI PRIMITIVES
// ---------------------------------------------------------------------------
const Card = ({ children, className = '', tone = 'paper' }) => (
  <div
    className={`relative rounded-sm ${className}`}
    style={{
      background: tone === 'ink' ? C.ink : C.card,
      border: `1px solid ${C.rule}`,
      boxShadow: '0 1px 0 rgba(11,31,42,0.03), 0 8px 24px -16px rgba(11,31,42,0.08)',
    }}
  >
    {children}
  </div>
);

const SectionTitle = ({ kicker, title, action, dark = false }) => (
  <div className="flex items-end justify-between mb-5 pb-3" style={{ borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : C.rule}` }}>
    <div>
      {kicker && (
        <div className="flex items-center gap-2 mb-1.5">
          <span style={{ background: C.accent, width: 18, height: 1, display: 'inline-block' }} />
          <span className="text-[10px] tracking-[0.22em] uppercase font-medium" style={{ color: dark ? C.accent : C.mute }}>
            {kicker}
          </span>
        </div>
      )}
      <h2 className="font-serif text-[22px] leading-tight tracking-tight" style={{ color: dark ? '#FAF7F1' : C.ink, fontFamily: '"Cormorant Garamond", "EB Garamond", Georgia, serif', fontWeight: 600 }}>
        {title}
      </h2>
    </div>
    {action}
  </div>
);

const Tip = ({ text, children }) => (
  <span className="group relative inline-flex">
    {children}
    <span className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 px-3 py-2 text-[11px] leading-snug rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150"
      style={{ background: C.ink, color: '#FAF7F1' }}>
      {text}
    </span>
  </span>
);

const Pill = ({ tone = 'mute', children, dot }) => {
  const tones = {
    mute:    { bg: '#F1ECDF', fg: C.ink2,   br: C.rule },
    fv:      { bg: C.fvSoft,  fg: C.fvDark, br: '#CBE5DB' },
    warn:    { bg: C.warnSoft,fg: C.warn,   br: '#EAD5A8' },
    danger:  { bg: C.dangerSoft, fg: C.danger, br: '#E8C9C9' },
    ink:     { bg: C.ink,     fg: '#FAF7F1',br: C.ink },
  };
  const s = tones[tone];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-sm border"
      style={{ background: s.bg, color: s.fg, borderColor: s.br, letterSpacing: '0.08em' }}>
      {dot && <span className="w-1 h-1 rounded-full" style={{ background: s.fg }} />}
      {children}
    </span>
  );
};

const NumInput = ({ value, onChange, step = 0.01, min, max, suffix, prefix, isPct = false, w = 'w-full' }) => {
  const display = isPct ? (value * 100).toFixed(1) : value;
  const handle = e => {
    let v = parseFloat(e.target.value);
    if (Number.isNaN(v)) v = 0;
    if (isPct) v = v / 100;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  return (
    <div className={`inline-flex items-center text-[11px] rounded-sm border ${w}`}
      style={{ background: '#FBF7EC', borderColor: '#E0CC8C' }}>
      {prefix && <span className="px-1.5 font-medium" style={{ color: C.warn }}>{prefix}</span>}
      <input
        type="number"
        step={isPct ? 0.1 : step}
        value={display}
        onChange={handle}
        className="w-full bg-transparent px-1.5 py-1 font-semibold tabular-nums focus:outline-none focus:ring-1 rounded-sm"
        style={{ color: '#1A3D8F' }}
      />
      {suffix && <span className="px-1.5 font-medium" style={{ color: C.warn }}>{suffix}</span>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 6. HEADLINE — the editorial masthead
// ---------------------------------------------------------------------------
const Masthead = ({ portfolio, onReset, onExport }) => {
  const baseline = 741121;       // v3 baseline shown for context (Q4 2025 model)
  const delta = portfolio.totalFV - baseline;
  const deltaPct = delta / baseline;

  return (
    <div className="relative overflow-hidden" style={{ background: C.ink, color: '#FAF7F1' }}>
      {/* subtle pattern */}
      <div aria-hidden className="absolute inset-0 opacity-[0.06]" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #FAF7F1 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }} />
      {/* gold edge */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)` }} />

      <div className="relative max-w-[1480px] mx-auto px-8 pt-7 pb-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-7 text-[10px] tracking-[0.25em] uppercase font-medium" style={{ color: C.accent }}>
          <div className="flex items-center gap-3">
            <span style={{ background: C.accent, width: 22, height: 1, display: 'inline-block' }} />
            <span>Shell Impact Fund · CLA Portfolio</span>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>
            <span style={{ color: 'rgba(250,247,241,0.55)' }}>Q1 2026 Refresh · v5</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onExport}
              className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-sm border transition tracking-[0.18em] uppercase"
              style={{ borderColor: 'rgba(201,169,97,0.4)', color: '#FAF7F1' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,169,97,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <Download size={11} /> Export
            </button>
            <button onClick={onReset}
              className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-sm border transition tracking-[0.18em] uppercase"
              style={{ borderColor: 'rgba(201,169,97,0.4)', color: '#FAF7F1' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,169,97,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <RotateCcw size={11} /> Reset
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="grid grid-cols-12 gap-8 items-end">
          <div className="col-span-12 lg:col-span-7">
            <h1 className="font-serif tracking-tight" style={{
              fontFamily: '"Cormorant Garamond", "EB Garamond", Georgia, serif',
              fontWeight: 500,
              fontSize: 'clamp(40px, 5vw, 64px)',
              lineHeight: 0.95,
              color: '#FAF7F1',
            }}>
              Convertible Loan Agreement
              <span className="block italic" style={{ color: C.accent, fontWeight: 400 }}>Fair Value Workbench</span>
            </h1>
            <p className="mt-5 text-[13px] leading-relaxed max-w-xl" style={{ color: 'rgba(250,247,241,0.7)' }}>
              An interactive probability-weighted expected present-value model for the five-CLA Shell Impact Fund portfolio,
              grounded in Q1 2026 quarterly reporting. Reconciles to the underlying Excel valuation engine to the cent.
            </p>
          </div>

          {/* Headline number */}
          <div className="col-span-12 lg:col-span-5 lg:border-l lg:pl-8" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
            <div className="text-[10px] tracking-[0.22em] uppercase mb-2" style={{ color: C.accent }}>Portfolio Fair Value · Base Case</div>
            <div className="font-serif tabular-nums leading-none" style={{
              fontFamily: '"Cormorant Garamond", Georgia, serif',
              fontWeight: 500,
              fontSize: 'clamp(48px, 6vw, 72px)',
              color: '#FAF7F1',
            }}>
              {fmtEUR(portfolio.totalFV)}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[12px]" style={{ color: 'rgba(250,247,241,0.7)' }}>
              <span className="tabular-nums">{fmtPct(portfolio.fvPctPrincipal)} of nominal</span>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
              <span className="tabular-nums inline-flex items-center gap-1" style={{ color: delta < 0 ? '#E89595' : '#9BD9C4' }}>
                {delta < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                {delta < 0 ? '−' : '+'}{fmtEURk(Math.abs(delta))} vs Q4 ’25 model ({fmtPct(Math.abs(deltaPct), 0)})
              </span>
            </div>
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] tracking-[0.22em] uppercase" style={{ color: C.accent }}>Transfer-Adjusted</div>
                  <div className="text-[11px]" style={{ color: 'rgba(250,247,241,0.55)' }}>after 30% illiquidity discount</div>
                </div>
                <div className="text-right font-serif tabular-nums text-[28px]" style={{
                  fontFamily: '"Cormorant Garamond", Georgia, serif',
                  fontWeight: 500,
                  color: '#FAF7F1',
                }}>
                  {fmtEUR(portfolio.transferAdjustedFV)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 flex flex-wrap items-center gap-3 text-[10px]" style={{ color: 'rgba(250,247,241,0.5)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="inline-flex items-center gap-1.5"><AlertTriangle size={10} /> Internal working valuation — not IFRS-13 / ASC 820 / audit-grade fair value opinion.</span>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
          <span>Prepared for the Shell → Fair Capital Partners handover</span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 7. KPI STRIP
// ---------------------------------------------------------------------------
const KpiCard = ({ label, value, sub, accent, icon: Icon }) => (
  <div className="relative p-5" style={{ background: C.card, border: `1px solid ${C.rule}`, borderRadius: 2 }}>
    {accent && <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: accent }} />}
    <div className="flex items-center justify-between mb-3">
      <div className="text-[10px] tracking-[0.18em] uppercase font-medium" style={{ color: C.mute }}>{label}</div>
      {Icon && <Icon size={13} strokeWidth={1.5} style={{ color: C.mute }} />}
    </div>
    <div className="font-serif tabular-nums leading-none" style={{
      fontFamily: '"Cormorant Garamond", Georgia, serif',
      fontWeight: 500, fontSize: 28, color: C.ink,
    }}>{value}</div>
    {sub && <div className="text-[11px] mt-2" style={{ color: C.mute }}>{sub}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// 8. PORTFOLIO TABLE
// ---------------------------------------------------------------------------
const PortfolioTable = ({ portfolio, updateCompany }) => {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12px] border-separate border-spacing-0">
        <thead>
          <tr className="text-[9px] uppercase tracking-[0.16em]" style={{ color: C.mute }}>
            {['Company', 'Stage / Health', 'P(conv)', 'P(repay)', 'P(default)', 'Σ', 'V exit (€)', 'V conv (€)', 'Uplift', 'Years', 'Impact', 'Fair value', '% of FV', 'Risk'].map((h, i) => (
              <th key={i} className={`font-medium px-3 py-3 ${i < 2 ? 'text-left' : i === 10 ? 'text-center' : i === 13 ? 'text-center' : 'text-right'}`}
                style={{ borderBottom: `2px solid ${C.ink}`, background: '#F5EFE2' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {portfolio.rows.map((r, idx) => {
            const sum = r.pC + r.pR + r.pD;
            const sumOk = Math.abs(sum - 1) < 0.001;
            const riskTone = r.pD >= 0.6 ? 'danger' : r.pD >= 0.35 ? 'warn' : 'fv';
            const riskLabel = r.pD >= 0.6 ? 'High' : r.pD >= 0.35 ? 'Med' : 'Low';
            return (
              <tr key={r.id} className="group" style={{ background: idx % 2 ? '#FBF8F1' : C.card }}>
                <td className="px-3 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <div className="font-serif text-[16px] leading-tight" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, color: C.ink }}>{r.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: C.mute }}>{r.sector}</div>
                </td>
                <td className="px-3 py-3 text-[10.5px] leading-snug max-w-[230px]" style={{ borderBottom: `1px solid ${C.ruleSoft}`, color: C.ink2 }}>
                  {r.stage}
                </td>
                <td className="px-3 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <NumInput isPct value={r.pConvert} onChange={v => updateCompany(r.id, 'pConvert', v)} suffix="%" min={0} max={1} w="w-20" />
                </td>
                <td className="px-3 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <NumInput isPct value={r.pRepay} onChange={v => updateCompany(r.id, 'pRepay', v)} suffix="%" min={0} max={1} w="w-20" />
                </td>
                <td className="px-3 py-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <NumInput isPct value={r.pDefault} onChange={v => updateCompany(r.id, 'pDefault', v)} suffix="%" min={0} max={1} w="w-20" />
                </td>
                <td className="px-3 py-3 text-right" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <span className={`inline-flex items-center gap-1 tabular-nums text-[11px] font-semibold`}
                    style={{ color: sumOk ? C.fv : C.danger }}>
                    {fmtPct(sum, 0)}
                  </span>
                </td>
                <td className="px-3 py-3 text-right" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <NumInput value={r.expectedValuation} step={50000} prefix="€" min={0} onChange={v => updateCompany(r.id, 'expectedValuation', v)} w="w-32" />
                </td>
                <td className="px-3 py-3 text-right" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <NumInput value={r.conversionRoundValuation} step={50000} prefix="€" min={1} onChange={v => updateCompany(r.id, 'conversionRoundValuation', v)} w="w-32" />
                </td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ borderBottom: `1px solid ${C.ruleSoft}`, color: C.ink2 }}>{fmtMult(r.uplift)}</td>
                <td className="px-3 py-3 text-right" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <NumInput value={r.yearsToResolution} step={0.5} suffix="y" min={0.1} onChange={v => updateCompany(r.id, 'yearsToResolution', v)} w="w-20" />
                </td>
                <td className="px-3 py-3 text-center" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <button onClick={() => updateCompany(r.id, 'impactMet', !r.impactMet)}
                    className="text-[9px] font-bold tracking-widest uppercase px-2 py-1 rounded-sm border transition"
                    style={{
                      background: r.impactMet ? C.fvSoft : '#F1ECDF',
                      color: r.impactMet ? C.fvDark : C.mute,
                      borderColor: r.impactMet ? '#CBE5DB' : C.rule,
                    }}>
                    {r.impactMet ? '✓ Met' : '— No'}
                  </button>
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-semibold" style={{ borderBottom: `1px solid ${C.ruleSoft}`, color: C.fvDark, background: C.fvSoft }}>
                  {fmtEUR(r.fairValue)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums" style={{ borderBottom: `1px solid ${C.ruleSoft}`, color: C.ink2 }}>
                  {fmtPct(r.fairValue / portfolio.totalFV)}
                </td>
                <td className="px-3 py-3 text-center" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                  <Pill tone={riskTone} dot>{riskLabel}</Pill>
                </td>
              </tr>
            );
          })}
          <tr style={{ background: C.ink }}>
            <td colSpan={11} className="px-3 py-3 text-[10px] tracking-[0.2em] uppercase font-medium" style={{ color: C.accent }}>Portfolio Total</td>
            <td className="px-3 py-3 text-right tabular-nums font-bold font-serif text-[16px]" style={{ color: '#FAF7F1', fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
              {fmtEUR(portfolio.totalFV)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-[12px]" style={{ color: 'rgba(250,247,241,0.7)' }}>
              {fmtPct(portfolio.fvPctPrincipal)}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 9. COMPANY DETAIL CARD
// ---------------------------------------------------------------------------
const CompanyCard = ({ c, totalFV }) => {
  const breakdown = [
    { name: 'Conversion',  value: c.pvConv,    color: COLORS.conv },
    { name: 'Repayment',   value: c.pvRepay,   color: COLORS.repay },
    { name: 'Default rec.',value: c.pvDefault, color: COLORS.def },
  ];
  const driver = breakdown.reduce((a, b) => b.value > a.value ? b : a);
  const riskTone = c.pD >= 0.6 ? 'danger' : c.pD >= 0.35 ? 'warn' : 'fv';
  const momentumIcon = c.momentum === 'positive' ? TrendingUp : c.momentum === 'negative' ? TrendingDown : Minus;
  const Momentum = momentumIcon;
  return (
    <Card className="p-5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-3 pb-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
        <div>
          <div className="font-serif text-[24px] leading-none" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, color: C.ink }}>{c.name}</div>
          <div className="text-[10px] mt-1 tracking-wide uppercase" style={{ color: C.mute, letterSpacing: '0.1em' }}>{c.sector}</div>
        </div>
        <Pill tone={riskTone} dot>{c.pD >= 0.6 ? 'High risk' : c.pD >= 0.35 ? 'Medium' : 'Low risk'}</Pill>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-[9px] tracking-[0.18em] uppercase font-medium" style={{ color: C.mute }}>Key metric</div>
          <div className="flex items-center gap-1 text-[12px] font-semibold mt-1" style={{ color: C.ink }}>
            <Momentum size={11} style={{ color: c.momentum === 'positive' ? C.fv : c.momentum === 'negative' ? C.danger : C.mute }} />
            {c.keyMetric}
          </div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.18em] uppercase font-medium" style={{ color: C.mute }}>Runway</div>
          <div className="text-[12px] font-semibold mt-1" style={{ color: C.ink }}>{c.runway}</div>
        </div>
      </div>

      <p className="text-[11.5px] leading-relaxed mb-4" style={{ color: C.ink2 }}>{c.rationale}</p>

      {/* Probability bar */}
      <div className="mb-4">
        <div className="text-[9px] tracking-[0.18em] uppercase font-medium mb-1.5" style={{ color: C.mute }}>Probability distribution</div>
        <div className="flex h-1.5 rounded-sm overflow-hidden" style={{ background: C.rule }}>
          <div style={{ width: `${c.pC * 100}%`, background: COLORS.conv }} />
          <div style={{ width: `${c.pR * 100}%`, background: COLORS.repay }} />
          <div style={{ width: `${c.pD * 100}%`, background: COLORS.def }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1.5 tabular-nums" style={{ color: C.mute }}>
          <span><span className="inline-block w-1.5 h-1.5 mr-1" style={{ background: COLORS.conv }} />Conv {fmtPct(c.pC, 0)}</span>
          <span><span className="inline-block w-1.5 h-1.5 mr-1" style={{ background: COLORS.repay }} />Repay {fmtPct(c.pR, 0)}</span>
          <span><span className="inline-block w-1.5 h-1.5 mr-1" style={{ background: COLORS.def }} />Def {fmtPct(c.pD, 0)}</span>
        </div>
      </div>

      {/* PV breakdown */}
      <div className="space-y-1.5 text-[11px] pb-3 mb-3" style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
        {[
          ['PV(conv) · P',  c.pvConv,    COLORS.conv],
          ['PV(repay) · P', c.pvRepay,   COLORS.repay],
          ['PV(def) · P',   c.pvDefault, COLORS.def],
        ].map(([label, val, color]) => (
          <div key={label} className="flex justify-between items-center">
            <span style={{ color: C.mute }}>{label}</span>
            <span className="tabular-nums font-medium" style={{ color }}>{fmtEUR(val)}</span>
          </div>
        ))}
      </div>

      {/* Footer — fair value */}
      <div className="mt-auto flex items-end justify-between">
        <div>
          <div className="text-[9px] tracking-[0.2em] uppercase" style={{ color: C.mute }}>Fair value</div>
          <div className="font-serif tabular-nums leading-none mt-1" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500, fontSize: 30, color: C.fvDark }}>
            {fmtEUR(c.fairValue)}
          </div>
          <div className="text-[10px] mt-1.5 tabular-nums" style={{ color: C.mute }}>
            {fmtPct(c.fairValue / 250000)} of nominal · {fmtPct(c.fairValue / totalFV, 1)} of portfolio
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-[0.2em] uppercase" style={{ color: C.mute }}>Driver</div>
          <div className="text-[12px] font-semibold mt-1" style={{ color: driver.color }}>{driver.name}</div>
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 10. ASSUMPTIONS PANEL
// ---------------------------------------------------------------------------
const AssumptionRow = ({ label, children }) => (
  <div className="grid grid-cols-5 items-center gap-2 mb-2">
    <label className="col-span-3 text-[11px]" style={{ color: C.ink2 }}>{label}</label>
    <div className="col-span-2">{children}</div>
  </div>
);

const AssumptionsPanel = ({ globals, setGlobals, reset }) => {
  const set = k => v => setGlobals({ ...globals, [k]: v });
  return (
    <Card className="p-5 sticky top-4">
      <SectionTitle kicker="Workbench" title="Global assumptions" action={
        <button onClick={reset} className="inline-flex items-center gap-1 text-[10px] tracking-[0.18em] uppercase font-medium transition" style={{ color: C.mute }}
          onMouseEnter={e => e.currentTarget.style.color = C.ink}
          onMouseLeave={e => e.currentTarget.style.color = C.mute}>
          <RotateCcw size={11} /> Reset
        </button>
      } />
      <div className="space-y-1">
        <div className="text-[9px] tracking-[0.2em] uppercase font-medium pb-1 mb-1" style={{ color: C.accent, borderBottom: `1px solid ${C.ruleSoft}` }}>Instrument</div>
        <AssumptionRow label="Principal per CLA"><NumInput value={globals.principal} step={5000} prefix="€" min={0} onChange={set('principal')} /></AssumptionRow>
        <AssumptionRow label={<Tip text="Annual paid-in-kind interest. Compounds into loan balance until resolution."><span className="border-b border-dotted cursor-help" style={{ borderColor: C.mute }}>PIK rate</span></Tip>}>
          <NumInput isPct value={globals.pikRate} suffix="%" min={0} max={1} onChange={set('pikRate')} />
        </AssumptionRow>
        <AssumptionRow label="Std. conv. discount"><NumInput isPct value={globals.stdConvDiscount} suffix="%" min={0} max={0.99} onChange={set('stdConvDiscount')} /></AssumptionRow>
        <AssumptionRow label="Impact-linked discount"><NumInput isPct value={globals.impactConvDiscount} suffix="%" min={0} max={0.99} onChange={set('impactConvDiscount')} /></AssumptionRow>

        <div className="text-[9px] tracking-[0.2em] uppercase font-medium pt-3 pb-1 mb-1" style={{ color: C.accent, borderBottom: `1px solid ${C.ruleSoft}` }}>Valuation</div>
        <AssumptionRow label={<Tip text="Required return used to discount expected cash flows. Higher rate = lower fair value."><span className="border-b border-dotted cursor-help" style={{ borderColor: C.mute }}>Discount rate (WACC)</span></Tip>}>
          <NumInput isPct value={globals.discountRate} suffix="%" min={0} max={1} onChange={set('discountRate')} />
        </AssumptionRow>
        <AssumptionRow label="Default recovery"><NumInput isPct value={globals.recoveryRate} suffix="%" min={0} max={1} onChange={set('recoveryRate')} /></AssumptionRow>
        <AssumptionRow label={<Tip text="Discount applied to portfolio fair value to reflect transfer/illiquidity in a real secondary CLA transaction."><span className="border-b border-dotted cursor-help" style={{ borderColor: C.mute }}>Illiquidity discount</span></Tip>}>
          <NumInput isPct value={globals.illiquidityDiscount} suffix="%" min={0} max={1} onChange={set('illiquidityDiscount')} />
        </AssumptionRow>

        <div className="flex items-center justify-between text-[9px] tracking-[0.2em] uppercase font-medium pt-3 pb-1 mb-1" style={{ color: C.accent, borderBottom: `1px solid ${C.ruleSoft}` }}>
          <span>Probability mode</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={globals.uniformProb} onChange={e => setGlobals({ ...globals, uniformProb: e.target.checked })} />
            <span style={{ color: C.mute, letterSpacing: '0.16em' }}>Uniform</span>
          </label>
        </div>
        <div className={globals.uniformProb ? '' : 'opacity-40 pointer-events-none'}>
          <AssumptionRow label="P(convert)"><NumInput isPct value={globals.uniformPConvert} suffix="%" min={0} max={1} onChange={set('uniformPConvert')} /></AssumptionRow>
          <AssumptionRow label="P(repay)"><NumInput isPct value={globals.uniformPRepay} suffix="%" min={0} max={1} onChange={set('uniformPRepay')} /></AssumptionRow>
          <AssumptionRow label="P(default)"><NumInput isPct value={globals.uniformPDefault} suffix="%" min={0} max={1} onChange={set('uniformPDefault')} /></AssumptionRow>
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 11. SCENARIO SECTION
// ---------------------------------------------------------------------------
const ScenarioSection = ({ companies, globals }) => {
  const base   = useMemo(() => computePortfolio(companies, globals), [companies, globals]);
  const downCo = useMemo(() => applyScenario(companies, globals.downsideExitMult, globals.downsideDefUplift), [companies, globals]);
  const upCo   = useMemo(() => applyScenario(companies, globals.upsideExitMult,   globals.upsideDefUplift),   [companies, globals]);
  const down   = useMemo(() => computePortfolio(downCo, globals), [downCo, globals]);
  const up     = useMemo(() => computePortfolio(upCo, globals),   [upCo, globals]);

  const data = [
    { name: 'Downside',  fv: down.totalFV,  pct: down.fvPctPrincipal,  fill: C.warn },
    { name: 'Base case', fv: base.totalFV,  pct: base.fvPctPrincipal,  fill: C.ink },
    { name: 'Upside',    fv: up.totalFV,    pct: up.fvPctPrincipal,    fill: C.fv },
  ];

  const cards = [
    { name: 'Downside',  icon: TrendingDown, accent: C.warn, fv: down.totalFV, pct: down.fvPctPrincipal, diff: down.totalFV - base.totalFV,
      desc: `Exit ${fmtMult(globals.downsideExitMult)} · default +${fmtPct(globals.downsideDefUplift, 0)}` },
    { name: 'Base case', icon: Target,       accent: C.ink,  fv: base.totalFV, pct: base.fvPctPrincipal, diff: 0,
      desc: 'Current company-specific assumptions' },
    { name: 'Upside',    icon: TrendingUp,   accent: C.fv,   fv: up.totalFV,   pct: up.fvPctPrincipal,   diff: up.totalFV - base.totalFV,
      desc: `Exit ${fmtMult(globals.upsideExitMult)} · default ${fmtPct(globals.upsideDefUplift, 0)}` },
  ];

  return (
    <Card className="p-6">
      <SectionTitle kicker="Stress Range" title="Scenario analysis" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {cards.map(c => {
          const Icon = c.icon;
          return (
            <div key={c.name} className="relative p-4" style={{
              background: c.name === 'Base case' ? C.ink : C.card,
              border: `1px solid ${c.name === 'Base case' ? C.ink : C.rule}`,
            }}>
              <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: c.accent }} />
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] tracking-[0.22em] uppercase font-medium" style={{ color: c.name === 'Base case' ? C.accent : C.mute }}>{c.name}</span>
                <Icon size={13} strokeWidth={1.5} style={{ color: c.name === 'Base case' ? C.accent : C.mute }} />
              </div>
              <div className="font-serif tabular-nums leading-none" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 500, fontSize: 30, color: c.name === 'Base case' ? '#FAF7F1' : c.accent }}>
                {fmtEUR(c.fv)}
              </div>
              <div className="text-[10px] mt-1.5 tabular-nums" style={{ color: c.name === 'Base case' ? 'rgba(250,247,241,0.5)' : C.mute }}>
                {fmtPct(c.pct)} of nominal
              </div>
              <div className="text-[11px] mt-3 leading-snug" style={{ color: c.name === 'Base case' ? 'rgba(250,247,241,0.7)' : C.ink2 }}>{c.desc}</div>
              {c.name !== 'Base case' && (
                <div className="text-[10px] mt-2.5 tabular-nums font-semibold" style={{ color: c.diff >= 0 ? C.fv : C.danger }}>
                  {c.diff >= 0 ? '+' : '−'}{fmtEURk(Math.abs(c.diff))} vs base
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3" style={{ background: '#FBF8F1', border: `1px solid ${C.ruleSoft}` }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={C.rule} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.ink2 }} axisLine={{ stroke: C.rule }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: C.mute }} tickFormatter={fmtEURk} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: C.ink, border: 'none', borderRadius: 2, color: '#FAF7F1', fontSize: 11 }}
              formatter={v => fmtEUR(v)}
            />
            <ReferenceLine y={1_250_000} stroke={C.accent} strokeDasharray="3 4"
              label={{ value: 'Nominal €1.25M', fontSize: 9, fill: C.accent, position: 'right' }} />
            <Bar dataKey="fv" radius={[2, 2, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
              <LabelList dataKey="fv" position="top" formatter={fmtEURk} style={{ fontSize: 11, fontWeight: 600, fill: C.ink }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[11px] mt-4 leading-relaxed" style={{ color: C.ink2 }}>
        <span className="font-semibold" style={{ color: C.ink }}>Implied range </span>
        <span className="tabular-nums">{fmtEURk(down.totalFV)} – {fmtEURk(up.totalFV)}</span>.
        Mirrors the Excel <em>Summary</em> sheet logic: downside applies a {fmtMult(globals.downsideExitMult)} multiplier to expected exit valuations and shifts {fmtPct(globals.downsideDefUplift, 0)} probability mass from conversion to default; upside reverses these.
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 12. SENSITIVITY HEATMAPS
// ---------------------------------------------------------------------------
function buildSensitivityMatrix1(companies, globals) {
  const valShifts = [-0.5, -0.25, 0, 0.25, 0.5, 1.0];
  const defUplifts = [-0.10, 0, 0.10, 0.20, 0.30];
  const grid = valShifts.map(vs =>
    defUplifts.map(du => {
      const adj = companies.map(c => ({
        ...c,
        expectedValuation: c.expectedValuation * (1 + vs),
        pConvert: Math.max(0, c.pConvert - du),
        pDefault: Math.min(1, c.pDefault + du),
      }));
      return computePortfolio(adj, globals).totalFV;
    })
  );
  return { rows: valShifts, cols: defUplifts, grid };
}

function buildSensitivityMatrix2(companies, globals) {
  const rates = [0.08, 0.12, 0.15, 0.20, 0.25, 0.30];
  const mults = [0.4, 0.7, 1.0, 1.3, 1.8, 2.5];
  const grid = rates.map(r =>
    mults.map(m => {
      const adj = companies.map(c => ({ ...c, expectedValuation: c.expectedValuation * m }));
      return computePortfolio(adj, { ...globals, discountRate: r }).totalFV;
    })
  );
  return { rows: rates, cols: mults, grid };
}

const Heatmap = ({ matrix, fmtRow, fmtCol, baseRowIdx, baseColIdx }) => {
  const flat = matrix.grid.flat();
  const min = Math.min(...flat); const max = Math.max(...flat);
  const colorFor = v => {
    const t = (v - min) / Math.max(1, max - min);
    // gradient parchment → ink-teal-green
    const r1 = [245, 239, 226]; // light parchment
    const r2 = [10, 110, 90];   // value green
    const r = Math.round(r1[0] + (r2[0] - r1[0]) * t);
    const g = Math.round(r1[1] + (r2[1] - r1[1]) * t);
    const b = Math.round(r1[2] + (r2[2] - r1[2]) * t);
    return `rgb(${r},${g},${b})`;
  };
  const textFor = v => ((v - min) / Math.max(1, max - min) > 0.55 ? '#FAF7F1' : C.ink);

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-separate border-spacing-0 mx-auto">
        <thead>
          <tr>
            <th className="px-2 py-1.5" />
            {matrix.cols.map((c, j) => (
              <th key={j} className="px-3 py-1.5 text-[10px] font-medium tabular-nums text-center"
                style={{ color: j === baseColIdx ? C.ink : C.mute, background: j === baseColIdx ? '#F1ECDF' : 'transparent' }}>
                {fmtCol(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 text-[10px] font-medium tabular-nums text-right"
                style={{ color: i === baseRowIdx ? C.ink : C.mute, background: i === baseRowIdx ? '#F1ECDF' : 'transparent' }}>
                {fmtRow(r)}
              </td>
              {matrix.cols.map((_, j) => {
                const v = matrix.grid[i][j];
                const isBase = i === baseRowIdx && j === baseColIdx;
                return (
                  <td key={j} className="px-2 py-1.5 text-center tabular-nums font-medium"
                    style={{
                      background: colorFor(v), color: textFor(v),
                      border: isBase ? `2px solid ${C.accent}` : `1px solid ${C.card}`,
                      position: 'relative', zIndex: isBase ? 10 : 1,
                    }}>
                    {fmtEURk(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SensitivitySection = ({ companies, globals }) => {
  const m1 = useMemo(() => buildSensitivityMatrix1(companies, globals), [companies, globals]);
  const m2 = useMemo(() => buildSensitivityMatrix2(companies, globals), [companies, globals]);
  return (
    <Card className="p-6">
      <SectionTitle kicker="Two-way Stress Tables" title="Sensitivity analysis" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h4 className="text-[10px] tracking-[0.18em] uppercase font-medium mb-1" style={{ color: C.ink }}>Matrix 1</h4>
          <p className="text-[11px] mb-3" style={{ color: C.mute }}>Conversion valuation shift × Default probability uplift</p>
          <Heatmap matrix={m1} baseRowIdx={2} baseColIdx={1}
            fmtRow={v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
            fmtCol={v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`} />
        </div>
        <div>
          <h4 className="text-[10px] tracking-[0.18em] uppercase font-medium mb-1" style={{ color: C.ink }}>Matrix 2</h4>
          <p className="text-[11px] mb-3" style={{ color: C.mute }}>Discount rate × Exit multiple uniformly applied</p>
          <Heatmap matrix={m2} baseRowIdx={2} baseColIdx={2}
            fmtRow={v => fmtPct(v, 0)} fmtCol={v => fmtMult(v)} />
        </div>
      </div>
      <div className="mt-6 pt-4 grid md:grid-cols-2 gap-6 text-[11.5px] leading-relaxed" style={{ borderTop: `1px solid ${C.ruleSoft}`, color: C.ink2 }}>
        <div>
          <div className="text-[9px] tracking-[0.2em] uppercase font-medium mb-1.5" style={{ color: C.accent }}>Interpretation</div>
          The portfolio is most sensitive to <strong style={{ color: C.ink }}>default-probability uplift</strong> — a +20pp uniform increase compresses fair value materially. Conversion-valuation shifts matter less because the conversion leg is already a minority of total FV in this Q1 2026 refresh.
        </div>
        <div>
          <div className="text-[9px] tracking-[0.2em] uppercase font-medium mb-1.5" style={{ color: C.accent }}>Implied band</div>
          Across the full grid, a defensible fair-value range for Fair Capital handover is <strong style={{ color: C.ink }} className="tabular-nums">€300k – €560k</strong>. The transfer-adjusted base of <span className="tabular-nums">€307k</span> sits inside this band as the most defensible single point.
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 13. PORTFOLIO CHARTS
// ---------------------------------------------------------------------------
const PortfolioCharts = ({ portfolio }) => {
  const fvByCompany = portfolio.rows.map(r => ({
    name: r.name, conv: r.pvConv, repay: r.pvRepay, def: r.pvDefault,
  }));
  const pathTotals = [
    { name: 'Conversion',   value: portfolio.totalPvConv,    color: COLORS.conv },
    { name: 'Repayment',    value: portfolio.totalPvRepay,   color: COLORS.repay },
    { name: 'Default rec.', value: portfolio.totalPvDefault, color: COLORS.def },
  ];
  return (
    <Card className="p-6">
      <SectionTitle kicker="Decomposition" title="Where the value comes from" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <h4 className="text-[10px] tracking-[0.18em] uppercase font-medium mb-3" style={{ color: C.ink2 }}>Fair value by company · stacked by outcome path</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={fvByCompany} margin={{ top: 16, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.rule} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.ink2 }} axisLine={{ stroke: C.rule }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: C.mute }} tickFormatter={fmtEURk} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: C.ink, border: 'none', borderRadius: 2, color: '#FAF7F1', fontSize: 11 }} formatter={(v, n) => [fmtEUR(v), n]} />
              <Bar dataKey="conv"  name="Conversion"   stackId="a" fill={COLORS.conv} />
              <Bar dataKey="repay" name="Repayment"    stackId="a" fill={COLORS.repay} />
              <Bar dataKey="def"   name="Default rec." stackId="a" fill={COLORS.def} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-2">
          <h4 className="text-[10px] tracking-[0.18em] uppercase font-medium mb-3" style={{ color: C.ink2 }}>Portfolio FV by outcome path</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pathTotals} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="none">
                {pathTotals.map((p, i) => <Cell key={i} fill={p.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: C.ink, border: 'none', borderRadius: 2, color: '#FAF7F1', fontSize: 11 }} formatter={v => fmtEUR(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {pathTotals.map(p => (
              <div key={p.name} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-2" style={{ color: C.ink2 }}>
                  <span className="w-2 h-2" style={{ background: p.color }} /> {p.name}
                </span>
                <span className="tabular-nums font-medium" style={{ color: C.ink }}>
                  {fmtEUR(p.value)} <span style={{ color: C.mute }}>· {fmtPct(p.value / portfolio.totalFV)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 14. KEY TAKEAWAYS — from Excel Summary sheet
// ---------------------------------------------------------------------------
const Takeaways = ({ portfolio }) => {
  const takeaways = [
    {
      title: 'Portfolio in genuine distress',
      body: 'Three of five companies have critical cash positions in Q1 2026. Newton has 1.16 months runway, Prets has €25k cash, Homii has €72k cash. P(default) is elevated for valid reasons.',
      icon: Flame, accent: C.danger,
    },
    {
      title: 'Homii is the anchor',
      body: `${fmtEUR(portfolio.rows[0]?.fairValue)} fair value driven by explicit repayment intent — not conversion upside. Without Homii's repayment commitment, portfolio FV would drop to ~€235k (19% of principal).`,
      icon: Shield, accent: C.fv,
    },
    {
      title: 'Newton is the swing variable',
      body: 'Series A close in the next 4–6 weeks is the biggest single variable. Success could add €100–150k to portfolio FV; failure would reduce it by ~€30k (already partly priced in).',
      icon: Zap, accent: C.warn,
    },
    {
      title: 'Realistic transfer range',
      body: 'Present €300–450k as the transfer-price range for the Shell → Fair Capital handover. €307k (transfer-adjusted) is the most defensible single point. Consistent with how distressed early-stage CLA portfolios transfer in real secondary transactions.',
      icon: ArrowRight, accent: C.conv,
    },
  ];
  return (
    <Card className="p-6">
      <SectionTitle kicker="For the handover" title="Key takeaways" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {takeaways.map((t, i) => {
          const Icon = t.icon;
          return (
            <div key={i} className="relative p-4 flex gap-3" style={{ background: '#FBF8F1', border: `1px solid ${C.ruleSoft}` }}>
              <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: t.accent }} />
              <div className="flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center" style={{ background: t.accent + '22' }}>
                <Icon size={14} strokeWidth={1.75} style={{ color: t.accent }} />
              </div>
              <div>
                <div className="font-serif text-[15px] leading-tight mb-1" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, color: C.ink }}>
                  {t.title}
                </div>
                <p className="text-[11.5px] leading-relaxed" style={{ color: C.ink2 }}>{t.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// 15. METHOD SECTION
// ---------------------------------------------------------------------------
const MethodSection = () => (
  <Card className="p-7">
    <SectionTitle kicker="Documentation" title="Method &amp; assumptions" />
    <div className="grid md:grid-cols-2 gap-x-10 gap-y-5 text-[12px] leading-relaxed" style={{ color: C.ink2 }}>
      {[
        ['What is a CLA?', 'A Convertible Loan Agreement is a debt instrument that either repays at maturity (with PIK interest), converts to equity at a discount on a qualifying financing event, or defaults with low recovery if the company fails. It is unsecured and subordinated.'],
        ['Probability-weighted expected value', 'Each CLA is modelled as three mutually exclusive paths. Expected cash flows on each path are discounted to today at a single risk-adjusted rate. This is the most defensible approach for a portfolio of early-stage instruments where outcomes are inherently probabilistic.'],
        ['Repayment path', 'Loan future value = Principal × (1 + PIK)^years. PV = LoanFV / (1 + r)^years. Weighted by P(repay).'],
        ['Conversion path', 'Conversion value = (LoanFV / (1 − discount)) × (V_exit / V_conv_round). The (1 − discount) gross-up reflects the discounted share price; the V_exit / V_conv_round ratio captures appreciation between conversion and exit. PV\'d and weighted by P(convert).'],
        ['Default path', 'Recovery = Principal × recovery rate (5% base — reasoned mid-low estimate for unsecured/subordinated paper). PV\'d and weighted by P(default).'],
        ['Discounting', '15% base discount rate reflects required return for early-stage venture cash flows. Lower than typical venture equity hurdle (25–35%) because of the debt floor; higher than corporate bond rate because equity-path outcomes dominate value.'],
        ['Impact-linked discount', 'If a company has met its impact target, the conversion discount is 5% (vs 15% standard). This rewards mission alignment by reducing dilution of the investee. Confirmed by Rockstart.'],
        ['Illiquidity discount (new in v5)', '30% applied to portfolio fair value to reflect the friction of a real secondary CLA transaction. The transfer-adjusted figure is the most defensible single point for the handover negotiation.'],
        ['Limitations', 'Internal working valuation only — not IFRS-13 / ASC 820 / audit-grade. Probabilities are judgement-based on Q1 2026 reporting signals. Conversion valuations depend on rounds not yet priced. No correlation between outcomes is modelled. For formal handover, an external valuer should be engaged.'],
      ].map(([title, body]) => (
        <div key={title}>
          <div className="font-serif text-[16px] leading-tight mb-1.5" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, color: C.ink }}>
            {title}
          </div>
          <p>{body}</p>
        </div>
      ))}
    </div>
  </Card>
);

// ---------------------------------------------------------------------------
// 16. ROOT APP
// ---------------------------------------------------------------------------
export default function App() {
  const [companies, setCompanies] = useState(BASE_COMPANIES);
  const [globals, setGlobals] = useState(BASE_GLOBAL);

  const updateCompany = useCallback((id, key, value) => {
    setCompanies(prev => prev.map(c => c.id === id ? { ...c, [key]: value } : c));
  }, []);

  const reset = useCallback(() => {
    setCompanies(BASE_COMPANIES);
    setGlobals(BASE_GLOBAL);
  }, []);

  const portfolio = useMemo(() => computePortfolio(companies, globals), [companies, globals]);
  const sumIssues = companies.filter(c => Math.abs(c.pConvert + c.pRepay + c.pDefault - 1) > 0.001);

  const exportSummary = () => {
    const headers = ['Company','Sector','P(conv)','P(repay)','P(default)','V_exit','V_conv','Uplift','Years','Impact','PV(conv)','PV(repay)','PV(def)','Fair Value'];
    const rows = portfolio.rows.map(r => [
      r.name, r.sector, r.pC, r.pR, r.pD, r.expectedValuation, r.conversionRoundValuation,
      r.uplift.toFixed(3), r.yearsToResolution, r.impactMet ? 'YES' : 'NO',
      r.pvConv.toFixed(2), r.pvRepay.toFixed(2), r.pvDefault.toFixed(2), r.fairValue.toFixed(2),
    ]);
    const totals = ['PORTFOLIO TOTAL','','','','','','','','','',
      portfolio.totalPvConv.toFixed(2), portfolio.totalPvRepay.toFixed(2),
      portfolio.totalPvDefault.toFixed(2), portfolio.totalFV.toFixed(2)];
    const transfer = ['TRANSFER-ADJUSTED','','','','','','','','','','','','',portfolio.transferAdjustedFV.toFixed(2)];
    const csv = [headers, ...rows, totals, transfer].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `SIF_CLA_FairValue_v5_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen" style={{ background: C.paper, color: C.ink, fontFamily: '"Source Sans 3", "Source Sans Pro", -apple-system, system-ui, sans-serif' }}>
      <Masthead portfolio={portfolio} onReset={reset} onExport={exportSummary} />

      {sumIssues.length > 0 && (
        <div className="max-w-[1480px] mx-auto px-8 mt-4">
          <div className="px-4 py-2 text-[11px] flex items-center gap-2" style={{ background: C.dangerSoft, border: `1px solid #E8C9C9`, color: C.danger }}>
            <AlertTriangle size={13} />
            <span>Probabilities do not sum to 100% for <strong>{sumIssues.map(c => c.name).join(', ')}</strong>. Fair value still computes but is not a proper expected value.</span>
          </div>
        </div>
      )}

      <main className="max-w-[1480px] mx-auto px-8 py-8 space-y-8">

        {/* KPI strip */}
        <div>
          <div className="text-[10px] tracking-[0.22em] uppercase font-medium mb-3 flex items-center gap-2" style={{ color: C.mute }}>
            <span style={{ background: C.accent, width: 18, height: 1, display: 'inline-block' }} />
            Headline metrics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Fair value · base" value={fmtEUR(portfolio.totalFV)} sub={`${fmtPct(portfolio.fvPctPrincipal)} of €${(portfolio.totalPrincipal/1e6).toFixed(2)}M nominal`} accent={C.fv} icon={Target} />
            <KpiCard label="Transfer-adjusted" value={fmtEUR(portfolio.transferAdjustedFV)} sub={`After ${fmtPct(globals.illiquidityDiscount, 0)} illiquidity discount`} accent={C.accent} icon={Activity} />
            <KpiCard label="Top contributor" value={portfolio.top.name} sub={`${fmtEUR(portfolio.top.fairValue)} · ${fmtPct(portfolio.top.fairValue / portfolio.totalFV)} of FV`} accent={C.conv} icon={ArrowRight} />
            <KpiCard label="Highest risk" value={portfolio.riskiest.name} sub={`P(default) = ${fmtPct(portfolio.riskiest.pD, 0)}`} accent={C.danger} icon={AlertTriangle} />
            <KpiCard label="Avg P(convert)" value={fmtPct(portfolio.avgPC, 0)} sub="Across portfolio" />
            <KpiCard label="Avg P(repay)" value={fmtPct(portfolio.avgPR, 0)} sub="Across portfolio" />
            <KpiCard label="Avg P(default)" value={fmtPct(portfolio.avgPD, 0)} sub="Across portfolio" />
            <KpiCard label="Discount to nominal" value={fmtEUR(portfolio.totalPrincipal - portfolio.totalFV)} sub={`${fmtPct((portfolio.totalPrincipal - portfolio.totalFV) / portfolio.totalPrincipal)} below par`} accent={C.warn} />
          </div>
        </div>

        {/* Table + assumptions */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
          <Card className="p-6">
            <SectionTitle kicker="Per-Company Workbench" title="Portfolio &amp; editable inputs"
              action={<div className="text-[10px] flex items-center gap-3" style={{ color: C.mute }}>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#FBF7EC', border: '1px solid #E0CC8C' }} /> Editable</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: C.fvSoft, border: '1px solid #CBE5DB' }} /> Output</span>
              </div>}
            />
            <PortfolioTable portfolio={portfolio} updateCompany={updateCompany} />
          </Card>
          <AssumptionsPanel globals={globals} setGlobals={setGlobals} reset={reset} />
        </div>

        {/* Takeaways */}
        <Takeaways portfolio={portfolio} />

        {/* Scenario + Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ScenarioSection companies={companies} globals={globals} />
          <PortfolioCharts portfolio={portfolio} />
        </div>

        {/* Company detail cards */}
        <div>
          <div className="mb-5 flex items-end justify-between pb-3" style={{ borderBottom: `1px solid ${C.rule}` }}>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span style={{ background: C.accent, width: 18, height: 1, display: 'inline-block' }} />
                <span className="text-[10px] tracking-[0.22em] uppercase font-medium" style={{ color: C.mute }}>Per-Company Detail</span>
              </div>
              <h2 className="font-serif text-[22px] leading-tight tracking-tight" style={{ fontFamily: '"Cormorant Garamond", Georgia, serif', fontWeight: 600, color: C.ink }}>
                The five positions
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {portfolio.rows.map(c => <CompanyCard key={c.id} c={c} totalFV={portfolio.totalFV} />)}
          </div>
        </div>

        <SensitivitySection companies={companies} globals={globals} />
        <MethodSection />

        <footer className="pt-6 mt-4 text-[10px] tracking-wide flex flex-wrap items-center justify-between gap-3" style={{ color: C.mute, borderTop: `1px solid ${C.rule}` }}>
          <span>Translated from <code className="px-1.5 py-0.5 rounded-sm" style={{ background: '#F1ECDF', color: C.ink }}>SIF_CLA_Fair_Value_Model_v5.xlsx</code> · Method: PWEV · Discount factor 1/(1+r)^t</span>
          <span>Internal working document · Sources: Rockstart, Q1 2026 reporting, ScaleX EuroTech Index, PitchBook, Qubit Capital</span>
        </footer>
      </main>
    </div>
  );
}
