// Sadə Node.js + Express backend-i: Asİm botunu OpenAI Assistants API-si ilə birləşdirir

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { AI_CONFIG } from "./config/ai.config.js";


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 1) Burada Assistants API üçün OpenAI müştərisini yaradırıq.
//    OPENAI_API_KEY dəyəri .env faylından oxunur (təhlükəsizlik üçün kodda saxlamırıq).

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 2) Sizin GPT Assistanta aid ID-ni buraya əlavə edin.
//    ChatGPT-də yaratdığınız Assistant səhifəsində "Assistant ID" göstərilir.
//    Məsələn: asst_XXXXXXXXXXXX

const ASIM_ASSISTANT_ID = process.env.ASIM_ASSISTANT_ID; // .env faylında saxlayın

// Assistants API cavablarından sənəd istinadlarını, fayl adlarını və sitatları silir.
function sanitizeReply(text) {
  if (!text) return "";
  return (
    text
      // OpenAI sənəd istinadları:  və oxşar
      .replace(/【[^】]*】/g, "")
      // Kvadrat mötərizədəki sitatlar: [1], [1:0], [1:0†file]
      .replace(/\[[0-9]+(?::[0-9]+)?[^\]]*\]/g, "")
      // Dairəvi mötərizədəki sitatlar: (1), (1:0), (1:0†file)
      .replace(/\([0-9]+(?::[0-9]+)?[^\)]*\)/g, "")
      // Bir neçə boşluğu tək boşluğa endirir
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

app.post("/api/asim-chat", async (req, res) => {
  const userMessage = req.body?.message ?? "";
  const threadId = req.body?.threadId ?? null;

  if (!userMessage) {
    return res.status(400).json({ error: "Mesaj boş ola bilməz" });
  }

  // Проверяем наличие переменных окружения
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const assistantId = ASIM_ASSISTANT_ID?.trim();

  if (!apiKey || !assistantId) {
    const missing = [];
    if (!apiKey) missing.push("OPENAI_API_KEY");
    if (!assistantId) missing.push("ASIM_ASSISTANT_ID");

    console.error(`Хəta: Aşağıdakı dəyişənlər təyin edilməyib: ${missing.join(", ")}`);
    return res.status(500).json({
      error: `Server düzgün qurulmayıb. .env faylında aşağıdakı dəyişənləri yoxlayın: ${missing.join(", ")}`,
    });
  }

  try {
    // Əgər thread ID varsa, mövcud thread-i istifadə edirik, yoxsa yenisini yaradırıq
    let thread;
    if (threadId) {
      thread = { id: threadId };
    } else {
      thread = await client.beta.threads.create();
    }

    const enrichedMessage = `
User input: ${userMessage}

Rules for Asan Imza AI assistant:
- ALWAYS search in attached Asan Imza documents using File Search before answering.
- Do not answer from memory. If not found in documents, say "Not found in documents" and ask where the error appears (portal / app / SIM menu).

When user input is or contains an error code (e.g. "0035"):
1) Use File Search to find the EXACT string "ERROR_CODE: 0035" (or "ERROR_CODE: <code>" for the given code).
2) Return the matched section with these headings exactly:
   - ERROR_CODE
   - ERROR_TITLE
   - DESCRIPTION
   - CAUSES
   - SOLUTION
3) If more than one match exists for the same code, show all titles and ask the user which one matches their screen.
4) If not found, say "Not found in documents" and ask where the error appears (portal, app, SIM menu).

General:
- Answer in user's language (Azerbaijani/Russian/English).
- Give detailed responses (meaning, reason, step-by-step solution, where to contact support if needed).
- NEVER answer too briefly.
`;

    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: enrichedMessage,
    });

    let run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
      model: "gpt-4.1",
      temperature: AI_CONFIG?.temperature ?? 0.1,
      top_p: AI_CONFIG?.top_p ?? 1.0,
      tool_choice: "auto"
    });

    if (run.status !== "completed") {
      return res.status(500).json({
        error: "Asİm cavabı tamamlamadı. Bir az sonra yenidən cəhd edin.",
      });
    }

    // ---- Check whether file_search was used (for the current run)
    let steps = await client.beta.threads.runs.steps.list(thread.id, run.id);

    let usedFileSearch = steps.data?.some((s) =>
      s.step_details?.type === "tool_calls" &&
      (s.step_details.tool_calls || []).some((tc) => tc.type === "file_search")
    );

    console.log("DEBUG usedFileSearch (run #1):", usedFileSearch);

    // ---- If file_search was NOT used, rerun with strict instructions
    if (!usedFileSearch) {
      run = await client.beta.threads.runs.createAndPoll(thread.id, {
        assistant_id: assistantId,
        model: "gpt-4.1",
        temperature: AI_CONFIG?.temperature ?? 0.1,
        top_p: AI_CONFIG?.top_p ?? 1.0,
        tool_choice: "auto",
        instructions: `
You MUST use File Search in the attached Asan Imza documents BEFORE answering.
Do not answer from memory.
If you cannot find the information in documents, say "Not found in documents" and ask a clarifying question.
Return a detailed answer based ONLY on documents.
`,
      });

      if (run.status !== "completed") {
        return res.status(500).json({
          error: "Asİm cavabı tamamlamadı. Bir az sonra yenidən cəhd edin.",
        });
      }

      // Re-check steps for rerun
      steps = await client.beta.threads.runs.steps.list(thread.id, run.id);

      usedFileSearch = steps.data?.some((s) =>
        s.step_details?.type === "tool_calls" &&
        (s.step_details.tool_calls || []).some((tc) => tc.type === "file_search")
      );

      console.log("DEBUG usedFileSearch (run #2):", usedFileSearch);
    }

    const messages = await client.beta.threads.messages.list(thread.id, {
      order: "desc",
      limit: 1,
    });

    const last = messages.data[0];
    let replyText = "";

    if (last && Array.isArray(last.content) && last.content.length > 0) {
      const textParts = last.content
        .filter((part) => part.type === "text")
        .map((part) => part.text?.value ?? "")
        .filter(Boolean);
      replyText = textParts.join("\n");
    }

    const notFoundFallback = "Bu məlumat əlavə edilmiş rəsmi Asan İmza sənədlərində tapılmadı. Zəhmət olmasa dəqiqləşdirin: bu kod harada çıxır (portal, mobil tətbiq, operator menyusu), hansı operator (Azercell/Bakcell/Nar), və hansı nömrə üzərində problem var?";
    if (!replyText || /not found in documents/i.test(replyText)) {
      replyText = notFoundFallback;
    }

    // Thread ID-ni client-ə qaytarırıq ki, sonrakı mesajlar üçün eyni thread-i istifadə edə bilsin
    const debug = process.env.DEBUG === "1"
      ? { runId: run.id, model: run.model ?? null, usedFileSearch }
      : undefined;

    return res.json({
      reply: sanitizeReply(replyText),
      threadId: thread.id,
      ...(debug ? { debug } : {})
    });
  } catch (err) {
    console.error("Asİm API xətası:", err);
    return res.status(500).json({ error: "Asİm ilə əlaqə zamanı xəta baş verdi." });
  }
});

app.listen(port, () => {
  console.log(`Asan Imza veb serveri http://localhost:${port} ünvanında işləyir`);
});
