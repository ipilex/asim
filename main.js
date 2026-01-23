const yearSpan = document.getElementById("year");
if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear().toString();
}

const chatWidget = document.getElementById("asim-widget");
const chatOverlay = document.getElementById("chat-overlay");
const openChatBtn = document.getElementById("open-chat");
const closeChatBtn = document.getElementById("close-chat");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");
const chatMessages = document.getElementById("chat-messages");

function toggleChat(open) {
  if (!chatWidget || !chatOverlay) return;
  const isOpen = open ?? chatWidget.classList.contains("hidden");
  if (isOpen) {
    chatWidget.classList.remove("hidden");
    chatOverlay.classList.remove("hidden");
    userInput?.focus();
  } else {
    chatWidget.classList.add("hidden");
    chatOverlay.classList.add("hidden");
  }
}

openChatBtn?.addEventListener("click", () => toggleChat(true));
closeChatBtn?.addEventListener("click", () => toggleChat(false));
chatOverlay?.addEventListener("click", () => toggleChat(false));

function addMessage(text, sender) {
  if (!chatMessages) return;
  const div = document.createElement("div");
  div.className = `message ${sender}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendToAsim(message) {
  addMessage(message, "user");

  addMessage("Asİm cavab hazırlayır...", "bot");
  const loadingEl = chatMessages.lastElementChild;

  try {
    // Thread ID-ni sessionStorage-dan alırıq (əgər varsa)
    const threadId = sessionStorage.getItem("asim_thread_id");
    
    const response = await fetch("/api/asim-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, threadId }),
    });

    if (!response.ok) {
      throw new Error("Server xətası baş verdi");
    }

    const data = await response.json();
    
    // Əgər server yeni thread ID qaytarırsa, onu saxlayırıq
    if (data.threadId) {
      sessionStorage.setItem("asim_thread_id", data.threadId);
    }
    
    if (loadingEl && loadingEl.parentElement) {
      loadingEl.parentElement.removeChild(loadingEl);
    }

    addMessage(data.reply ?? "Hazırda cavab almaq mümkün olmadı, bir az sonra yenidən yoxlayın.", "bot");
  } catch (err) {
    console.error(err);
    if (loadingEl && loadingEl.parentElement) {
      loadingEl.parentElement.removeChild(loadingEl);
    }
    addMessage("Bağlantıda problem yarandı. Zəhmət olmasa bir daha cəhd edin.", "bot");
  }
}

chatForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!userInput || !userInput.value.trim()) return;
  const message = userInput.value.trim();
  userInput.value = "";
  sendToAsim(message);
});

if (chatWidget && chatOverlay) {
  chatWidget.classList.add("hidden");
  chatOverlay.classList.add("hidden");
}
