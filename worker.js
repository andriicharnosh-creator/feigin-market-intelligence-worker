/**
 * Feigin Electric — Market Intelligence Worker
 * Cron: 0 6 * * * (08:00 Warsaw = 06:00 UTC)
 * Co robi:
 *   1. Pobiera sygnały P1/P2 z ostatnich 24h z Mission Control API
 *   2. Generuje analizę przez Claude (Anthropic API)
 *   3. Wysyła dzienny digest email przez Resend
 *   4. Poniedziałki: wysyła tygodniowy raport zarządczy
 */

const MISSION_CONTROL_API = 'https://feigin-mission-control-api-production.up.railway.app';
const BRIEFING_API = `${MISSION_CONTROL_API}/api/briefing`;
const MI_API = `${MISSION_CONTROL_API}/api/market-intelligence`;

// Źródła do monitorowania
const SOURCES = [
  // Regulacyjne
  { url: 'https://www.ure.gov.pl/pl/urzad/informacje-ogolne/aktualnosci/', name: 'URE Aktualności', type: 'regulatory' },
  { url: 'https://www.pse.pl/aktualnosci', name: 'PSE Aktualności', type: 'regulatory' },
  // Energetyczne
  { url: 'https://wysokienapiecie.pl/', name: 'WysokieNapiecie.pl', type: 'industry' },
  { url: 'https://gramwzielone.pl/', name: 'GramwZielone.pl', type: 'industry' },
  { url: 'https://www.cire.pl/', name: 'CIRE.pl', type: 'industry' },
  // Przetargi
  { url: 'https://ted.europa.eu/TED/search/search.do?FILTERS=analizator+energii,kompensacja+mocy+biernej,EMS+energia', name: 'TED Przetargi', type: 'tender' },
  // LinkedIn (public posts)
  { url: 'https://www.linkedin.com/search/results/content/?keywords=wyłączanie%20falownika%20napięcie&datePosted=past-week', name: 'LinkedIn Energy PL', type: 'social' },
];

const SEARCH_QUERIES = [
  'wyłączanie falownika napięcie sieć Polska',
  'moc bierna kompensacja kara przemysł',
  'EMS monitoring energii przetarg',
  'jakość energii harmoniczne przemysł',
  'fotowoltaika curtailment ograniczenie',
  'ECOD optymalizacja napięcia oszczędności',
  'analizator energii elektrycznej zakup',
  'rachunek za energię redukcja przemysł',
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMarketIntelligence(env));
  },
  async fetch(request, env) {
    if (request.method === 'POST') {
      await runMarketIntelligence(env);
      return new Response('Market Intelligence digest triggered', { status: 200 });
    }
    return new Response('Feigin Market Intelligence Worker — POST to trigger', { status: 200 });
  }
};

async function runMarketIntelligence(env) {
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const dateStr = now.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });

  console.log(`[MI] Start: ${dateStr}, Monday: ${isMonday}`);

  try {
    // 1. Pobierz istniejące sygnały P1 z API
    const existingSignals = await fetchExistingSignals(env);
    
    // 2. Skanuj źródła przez Claude
    const newSignals = await scanSourcesWithClaude(env, SEARCH_QUERIES);
    
    // 3. Zapisz nowe sygnały do API
    const savedSignals = await saveSignals(env, newSignals);
    
    // 4. Pobierz brief dzienny
    const brief = await fetchDailyBrief();

    // 5. Generuj digest email
    const allSignals = [...existingSignals, ...savedSignals];
    const emailHtml = generateDigestEmail(allSignals, brief, dateStr, isMonday);

    // 6. Wyślij email
    await sendEmail(env, {
      to: 'a.charnosh@feiginelectric.com',
      cc: ['g.przewozny@feiginelectric.com'],
      subject: isMonday
        ? `📡 Weekly Market Intelligence — ${dateStr}`
        : `📡 Daily Market Intelligence — ${dateStr}`,
      html: emailHtml,
    });

    console.log(`[MI] Done. New signals: ${savedSignals.length}, Total P1: ${allSignals.filter(s=>s.priority==='P1').length}`);
  } catch (e) {
    console.error('[MI] Error:', e.message);
    // Wyślij alert o błędzie
    await sendEmail(env, {
      to: 'a.charnosh@feiginelectric.com',
      subject: `⚠️ MI Worker Error — ${dateStr}`,
      html: `<p>Market Intelligence Worker napotkał błąd: ${e.message}</p>`,
    });
  }
}

async function scanSourcesWithClaude(env, queries) {
  if (!env.ANTHROPIC_KEY) return [];
  
  const signals = [];
  
  // Przygotuj zapytanie do Claude z instrukcją skanowania
  const prompt = `Jesteś Market Intelligence Analysterem dla Feigin Electric — firmy sprzedającej urządzenia ECOD (optymalizatory napięcia) i systemy EMS (monitoring energii).

Twoim zadaniem jest analiza rynku energetycznego w Polsce i identyfikacja sygnałów sprzedażowych.

Produkty Feigin Electric:
- ECOD: urządzenia redukujące napięcie, poprawiające cosφ → oszczędności 5-15%
- EMS: analizatory i systemy monitoringu energii elektrycznej
- Białe certyfikaty: wsparcie procesu uzyskiwania

Docelowi klienci: zakłady przemysłowe, przetwórstwo spożywcze (pieczarkarnie, mleczarnie, fermy), handel wielkopowierzchniowy, chłodnie, drukarnie.

Przeszukaj dostępną wiedzę o aktualnym rynku energetycznym w Polsce (2025-2026) i zidentyfikuj 5-8 konkretnych sygnałów rynkowych.

Dla każdego sygnału zwróć JSON:
{
  "title": "krótki tytuł (max 80 znaków)",
  "summary": "opis sygnału (2-3 zdania)",
  "source_name": "nazwa źródła",
  "source_url": "URL lub 'https://feiginelectric.pl' jeśli brak",
  "classification": "problem_klienta|regulacja|przetarg|konkurencja|marketing|trend",
  "sector": "sektor klienta np. chłodnie, piekarnie",
  "technology_angle": "ECOD|EMS|SVG|APF|białe certyfikaty",
  "evidence_strength": "weak|medium|strong",
  "confidence": 0-100,
  "priority": "P1|P2|P3",
  "is_actionable": true|false,
  "owner": "CEO|Sales|Scout|Energy Analyst|Marketing",
  "next_step": "konkretne działanie",
  "facts": "fakty z sygnału",
  "commercial_hypothesis": "jak to przekłada się na szansę sprzedażową Feigin"
}

Zwróć TYLKO tablicę JSON, bez żadnego innego tekstu.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '[]';
    
    // Parse JSON
    const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanText);
    
    // Dodaj duplicate_key żeby uniknąć duplikatów
    return parsed.map(s => ({
      ...s,
      duplicate_key: `${s.title.substring(0,50)}-${new Date().toISOString().split('T')[0]}`,
    }));
  } catch (e) {
    console.error('[MI] Claude scan error:', e.message);
    return [];
  }
}

async function fetchExistingSignals(env) {
  try {
    const r = await fetch(`${MI_API}/signals?status=NEW&limit=20`);
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function saveSignals(env, signals) {
  const saved = [];
  for (const signal of signals) {
    try {
      const r = await fetch(`${MI_API}/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signal),
      });
      if (r.ok) saved.push(await r.json());
    } catch (e) {
      console.error('[MI] Save signal error:', e.message);
    }
  }
  return saved;
}

async function fetchDailyBrief() {
  try {
    const r = await fetch(BRIEFING_API, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function generateDigestEmail(signals, brief, dateStr, isWeekly) {
  const p1 = signals.filter(s => s.priority === 'P1');
  const p2 = signals.filter(s => s.priority === 'P2');
  const p3 = signals.filter(s => s.priority === 'P3');
  const actionable = signals.filter(s => s.is_actionable);

  const signalHtml = (list, color) => list.slice(0, 5).map(s => `
    <div style="border-left:3px solid ${color};padding:10px 14px;margin:8px 0;background:#f9f9f9;border-radius:0 4px 4px 0">
      <div style="font-weight:700;color:#1a1a18;margin-bottom:4px">${s.title}</div>
      <div style="color:#555;font-size:13px;line-height:1.5">${s.summary}</div>
      ${s.next_step ? `<div style="color:#cc0000;font-size:12px;margin-top:6px;font-weight:600">→ ${s.next_step}</div>` : ''}
      <div style="font-size:11px;color:#888;margin-top:4px">
        ${s.sector || ''} · Confidence: ${s.confidence}% · ${s.owner || 'CEO'}
        ${s.source_url ? ` · <a href="${s.source_url}" style="color:#cc0000">Źródło</a>` : ''}
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1a1a18">
  <div style="background:#1a1a18;padding:20px 28px;border-bottom:3px solid #cc0000">
    <div style="color:#fff;font-size:11px;font-family:monospace;letter-spacing:.1em;text-transform:uppercase">Feigin Electric</div>
    <div style="color:#cc0000;font-size:20px;font-weight:700;margin-top:4px">
      ${isWeekly ? '📡 Weekly Market Intelligence' : '📡 Daily Market Intelligence'}
    </div>
    <div style="color:#888;font-size:12px;margin-top:4px">${dateStr}</div>
  </div>

  <div style="padding:20px 28px">
    <!-- KPI -->
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <div style="background:#fff5f5;border:1px solid #fcc;padding:12px 16px;border-radius:6px;text-align:center;min-width:100px">
        <div style="font-size:24px;font-weight:700;color:#cc0000">${p1.length}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">P1 Pilne</div>
      </div>
      <div style="background:#fff8e1;border:1px solid #fde68a;padding:12px 16px;border-radius:6px;text-align:center;min-width:100px">
        <div style="font-size:24px;font-weight:700;color:#d48000">${p2.length}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">P2 Ważne</div>
      </div>
      <div style="background:#f0fff4;border:1px solid #bbf7d0;padding:12px 16px;border-radius:6px;text-align:center;min-width:100px">
        <div style="font-size:24px;font-weight:700;color:#15803d">${p3.length}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">P3 Obserwuj</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:12px 16px;border-radius:6px;text-align:center;min-width:100px">
        <div style="font-size:24px;font-weight:700;color:#1d4ed8">${actionable.length}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">Akcjonowalne</div>
      </div>
    </div>

    ${brief ? `
    <!-- Brief -->
    <div style="background:#f8f8f6;border-radius:6px;padding:14px 16px;margin-bottom:20px">
      <div style="font-size:11px;font-family:monospace;color:#888;text-transform:uppercase;margin-bottom:8px">📋 Stan Operacyjny · ${brief.date}</div>
      ${brief.priorities?.slice(0,3).map(p => `<div style="font-size:13px;color:#333;margin:4px 0">• ${p.text}</div>`).join('') || ''}
    </div>` : ''}

    ${p1.length ? `
    <h3 style="color:#cc0000;border-bottom:2px solid #cc0000;padding-bottom:6px">🔴 P1 — Wymaga natychmiastowej reakcji</h3>
    ${signalHtml(p1, '#cc0000')}` : ''}

    ${p2.length ? `
    <h3 style="color:#d48000;border-bottom:1px solid #fde68a;padding-bottom:6px;margin-top:24px">🟡 P2 — Ważne sygnały</h3>
    ${signalHtml(p2, '#d48000')}` : ''}

    ${p3.length ? `
    <h3 style="color:#15803d;border-bottom:1px solid #bbf7d0;padding-bottom:6px;margin-top:24px">🟢 P3 — Obserwuj</h3>
    ${signalHtml(p3, '#15803d')}` : ''}

    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa">
      <a href="https://feigin-dashboard-production.up.railway.app" style="color:#cc0000;font-weight:600">→ Otwórz Dashboard</a> ·
      Generowane automatycznie przez Feigin MI Worker ·
      ${dateStr}
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(env, { to, cc, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.log('[MI] No RESEND_API_KEY — skipping email');
    return;
  }
  const body = { from: 'Feigin MI <mi@feiginelectric.pl>', to: Array.isArray(to) ? to : [to], subject, html };
  if (cc?.length) body.cc = cc;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify(body),
  });
  console.log('[MI] Email sent:', r.status, subject);
}
