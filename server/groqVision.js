const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TIMEOUT_MS = 45000;

const USER_PROMPT = `Extract all bank transactions from this bank statement image.

Return ONLY a valid JSON array — no explanation, no markdown, no code blocks.

Each object in the array must have exactly these fields:
- "date": string in MM/DD/YYYY format
- "description": string (the transaction description as written)
- "amount": number (negative for withdrawals/debits/payments/fees, positive for deposits/credits)

Rules:
- Skip header rows, running totals, beginning balance, ending balance, and daily balance summary rows
- Bank statement rows typically have the format: Date | Description | Amount | Running Balance
- The LAST column is usually the running Balance — DO NOT use it as the transaction amount
- Use ONLY the Debit, Credit, Withdrawal, or Deposit column for the amount value
- If you see separate Debit and Credit columns, use the appropriate sign
- If a transaction is in the Debit/Withdrawal column, the amount is negative
- If a transaction is in the Credit/Deposit column, the amount is positive
- Return [] if no transactions are found on this page`;

async function extractTransactionsFromImages(base64Images, apiKey) {
  const allTransactions = [];

  for (let i = 0; i < base64Images.length; i++) {
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
          model: VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${base64Images[i]}`
                  }
                },
                {
                  type: "text",
                  text: USER_PROMPT
                }
              ]
            }
          ],
          temperature: 0,
          max_tokens: 4096
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.log(`[vision] Page ${i + 1}/${base64Images.length} failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = parseJsonArray(content);

      if (Array.isArray(parsed)) {
        for (const tx of parsed) {
          if (tx.date && tx.description && tx.amount !== undefined) {
            allTransactions.push({
              date: String(tx.date).trim(),
              description: String(tx.description).trim(),
              amount: Number(tx.amount)
            });
          }
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(`[vision] Page ${i + 1}/${base64Images.length} error: ${error.message}`);
    }
  }

  return allTransactions;
}

function parseJsonArray(content) {
  const text = content.trim();

  // Direct JSON array
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // JSON inside markdown code block
  const codeMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1]); } catch {}
  }

  // Bare JSON array anywhere in the response
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch {}
  }

  return null;
}

module.exports = { extractTransactionsFromImages };
