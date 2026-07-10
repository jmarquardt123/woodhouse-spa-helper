// Email via Resend's REST API. No SDK. If RESEND_API_KEY is absent, sending is
// unavailable (the UI hides alert features). RESEND_API_KEY="log" makes sends
// no-op successes for local testing.

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("email not configured");
  if (key === "log") { console.log("[mail:log]", to, subject); return { id: "log" }; }
  const from = process.env.MAIL_FROM || "Woodhouse Spa Openings <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("resend " + r.status + ": " + JSON.stringify(body).slice(0, 200));
  return body;
}

function emailReady() { return !!process.env.RESEND_API_KEY; }

function shell(title, bodyHtml) {
  return `<!doctype html><body style="margin:0;padding:32px 16px;background:#F6F2E9;color:#2A2118;font-family:Georgia,serif">
  <div style="max-width:520px;margin:0 auto;background:#FCFAF4;border:1px solid #E3DAC8;border-radius:16px;padding:28px">
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:.28em;color:#75685A">WOODHOUSE SPA</p>
  <p style="margin:0 0 18px;font-size:22px;font-weight:bold">Openings</p>
  <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
  ${bodyHtml}
  </div></body>`;
}

module.exports = { sendMail, emailReady, shell };
