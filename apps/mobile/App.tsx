import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type { ChatMessage } from "@hobo/shared";
import { ChatApiError, sendChat } from "./src/api/chat";
import { useClientId } from "./src/state/useClientId";

const PROXY_URL = "http://127.0.0.1:8787/chat";
const SYSTEM_PROMPT =
  "You=Hank, wise wandering hobo, polymath. Speak warm, casual, dry wit. Max 120 words. Do not state you are AI.";

type UiMessage = ChatMessage & {
  id: string;
  routedProvider?: string;
};

function makeMessage(role: ChatMessage["role"], content: string, routedProvider?: string): UiMessage {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    ...(routedProvider ? { routedProvider } : {})
  };
}

function friendlyError(error: unknown) {
  if (error instanceof ChatApiError) {
    if (error.status === 429) return "Hank's tin cup is cooling off. Try again in a minute.";
    if (error.status >= 500) return "The campfire at the proxy went out. Try again shortly.";
    return error.message;
  }

  return "You look offline from here. Check the connection and try again.";
}

export default function App() {
  const clientId = useClientId();
  const [messages, setMessages] = useState<UiMessage[]>([
    makeMessage("assistant", "Evening, friend. What trail are we wandering down today?")
  ]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const canSend = useMemo(
    () => Boolean(clientId && draft.trim() && !isSending),
    [clientId, draft, isSending]
  );

  async function handleSend() {
    if (!canSend || !clientId) return;

    const text = draft.trim();
    const userMessage = makeMessage("user", text);
    const nextMessages = [...messages, userMessage];

    setDraft("");
    setError(null);
    setMessages(nextMessages);
    setIsSending(true);

    try {
      const response = await sendChat(PROXY_URL, clientId, {
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        systemPrompt: SYSTEM_PROMPT
      });

      console.log("Hobo chat response", { routedProvider: response.routedProvider });
      setMessages((current) => [
        ...current,
        makeMessage("assistant", response.text, response.routedProvider)
      ]);
    } catch (sendError) {
      console.warn("Hobo chat request failed", sendError);
      setError(friendlyError(sendError));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Hobo</Text>
          <Text style={styles.subtitle}>Worker proxy chat</Text>
        </View>

        <FlatList
          contentContainerStyle={styles.messages}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.userBubble : styles.assistantBubble
              ]}
            >
              <Text style={item.role === "user" ? styles.userText : styles.assistantText}>
                {item.content}
              </Text>
              {item.routedProvider ? (
                <Text style={styles.provider}>via {item.routedProvider}</Text>
              ) : null}
            </View>
          )}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.composer}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder="Ask Hank something..."
            placeholderTextColor="#7b7568"
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!canSend}
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendButton,
              (!canSend || pressed) && styles.sendButtonMuted
            ]}
          >
            {isSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Send</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4ead2"
  },
  screen: {
    flex: 1
  },
  header: {
    borderBottomColor: "#d2c3a3",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  title: {
    color: "#24211b",
    fontSize: 28,
    fontWeight: "700"
  },
  subtitle: {
    color: "#6a6256",
    fontSize: 13,
    marginTop: 2
  },
  messages: {
    gap: 10,
    padding: 16
  },
  bubble: {
    borderRadius: 8,
    maxWidth: "86%",
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: "#fffaf0",
    borderColor: "#dfd0af",
    borderWidth: StyleSheet.hairlineWidth
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#315a52"
  },
  assistantText: {
    color: "#27231c",
    fontSize: 16,
    lineHeight: 22
  },
  userText: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 22
  },
  provider: {
    color: "#7b7568",
    fontSize: 11,
    marginTop: 6
  },
  error: {
    color: "#8b1f1f",
    fontSize: 14,
    paddingHorizontal: 18,
    paddingVertical: 8
  },
  composer: {
    alignItems: "flex-end",
    borderTopColor: "#d2c3a3",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    padding: 12
  },
  input: {
    backgroundColor: "#fffaf0",
    borderColor: "#c7b996",
    borderRadius: 8,
    borderWidth: 1,
    color: "#24211b",
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#315a52",
    borderRadius: 8,
    height: 46,
    justifyContent: "center",
    width: 72
  },
  sendButtonMuted: {
    opacity: 0.55
  },
  sendText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700"
  }
});
