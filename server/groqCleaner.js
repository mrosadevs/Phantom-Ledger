const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const BATCH_SIZE = 40;
const TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `You clean bank transaction descriptions. For each numbered line I send, return ONLY the clean merchant or payee name on the same numbered line.

Rules:
- Extract the person, company, or merchant name only
- Remove bank codes, reference numbers, dates, card numbers, confirmation numbers
- Remove prefixes like "FUNDS TRANSFER WIRE FROM", "MISC DEPOSIT", "DEBIT CARD PURCH", etc.
- Keep it short — just the name, nothing else
- If the input is already a clean name, return it unchanged
- If it's a fee or service charge, return a short label like "Wire Fee", "Service Fee", "Overdraft Fee"
- Never return empty lines — if unsure, return the input unchanged
- Return exactly the same number of lines as the input

Example input:
1. RICA RDO EL JAU HARI ABDEL
2. INCOMING WIRE FEE
3. WMT PLUS JEANETTE M

Example output:
1. Rica Rdo El Jau Hari Abdel
2. Incoming Wire Fee
3. WMT Plus Jeanette M`;

async function cleanWithGroq(descriptions, apiKey) {
  if (!apiKey || !descriptions.length) {
    return descriptions;
  }

  const batches = [];
  for (let i = 0; i < descriptions.length; i += BATCH_SIZE) {
    batches.push(descriptions.slice(i, i + BATCH_SIZE));
  }

  const results = [...descriptions];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const offset = batchIndex * BATCH_SIZE;
    const numbered = batch.map((d, i) => `${i + 1}. ${d}`).join("\n");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: numbered }
          ],
          temperature: 0,
          max_tokens: 4096
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.log(`[groq] Batch ${batchIndex + 1}/${batches.length} failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const lines = content.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        const match = line.match(/^(\d+)\.\s*(.+)/);
        if (match) {
          const idx = parseInt(match[1], 10) - 1;
          const cleaned = match[2].trim();
          if (idx >= 0 && idx < batch.length && cleaned) {
            results[offset + idx] = cleaned;
          }
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(`[groq] Batch ${batchIndex + 1}/${batches.length} error: ${error.message}`);
    }
  }

  return results;
}

module.exports = { cleanWithGroq };
