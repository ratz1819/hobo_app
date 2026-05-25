Technical Architecture and Production Readiness Report for Hobo: Scalable Fallback Infrastructure, Local-First Reactive Databases, and Compliance-Engineered Payment MechanicsCloud Edge Infrastructure and Resilient Multi-Provider Proxy RoutingThe architectural decision to transition an artificial intelligence conversational agent from a client-side prototype to a production-grade application requires a fundamental restructuring of its network topology. In an early-stage configuration, bundling high-privilege API credentials for Large Language Model (LLM) providers such as Groq, Google AI Studio, or Cerebras directly within a client-side mobile application bundle presents an unacceptable vulnerability. Reverse-engineering toolchains can easily extract plaintext variables from compiled JavaScript bundles, leading to rapid rate-limit exhaustion, credential revocation, and financial risk.To mitigate these security vectors while preserving the low-cost profile of the free tier APIs, the architecture implements a serverless proxy layer deployed on the Cloudflare Workers edge network. This serverless proxy acts as a secure key vault, intercepts all client requests, evaluates incoming authentication, and manages real-time model failover routing. By routing traffic through this middleware, the client application remains decoupled from provider-specific endpoints, exposing only a single, authenticated gateway to the mobile interface.The orchestration layer targets three distinct backend providers using an OpenAI-compatible interface, creating a tiered network stack :Primary Layer (Groq): Utilizing the Llama 3.3 70B model to deliver extremely low-latency conversations (sub-50ms latency, 315 tokens per second). Groq handles up to approximately 1,000 requests per day before rate thresholds are reached.Secondary Layer (Google AI Studio): Running Gemini 2.5 Flash as the secondary fallback. It offers a higher capacity of 1,500 requests per day and a massive 1-million-token context window, making it highly effective for longer conversations.Tertiary Layer (Cerebras): Deploying Llama 3.3 70B on high-throughput compute engines to process overflow traffic up to approximately 1,700 requests per day.This multi-provider stack provides a combined daily capacity of roughly 4,200 requests. For a consumer-facing application, this capacity is sufficient to support hundreds of daily active users at zero model-licensing cost, completely removing registration barriers or token caps for end-users.Edge-Native Rate Limiting and Fallover ExecutionThe proxy layer uses Cloudflare's native rate-limiting bindings to prevent DDoS attacks and API resource exhaustion. The proxy avoids tracking clients by raw IP addresses—which are unstable on mobile networks and can lead to accidental rate limiting of clean users sharing cellular gateways—and instead identifies unique installations using a cryptographically secure client token. This token is generated during the application's first launch, saved in local storage, and sent via HTTP headers on every request.To implement this, the rate-limiting namespace MY_RATE_LIMITER is configured in the Cloudflare Worker settings. It uses a simple rolling window of 100 requests per 60 seconds per client installation.JavaScript// src/index.js - Cloudflare Worker Secure LLM Proxy & Fallback Engine
export default {
  async fetch(request, env) {
    if (request.method!== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 1. Enforce Client-Level Rate Limiting via Native Bindings
    const clientId = request.headers.get("X-Hobo-Client-ID") || "anonymous";
    try {
      const { success } = await env.MY_RATE_LIMITER.limit({ key: clientId });
      if (!success) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please spare some change." }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
    } catch (err) {
      console.error("Rate limiting binding error:", err);
    }

    // 2. Parse Incoming Chat History Payload
    let clientPayload;
    try {
      clientPayload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const messages = clientPayload.messages ||;
    const systemPrompt = clientPayload.systemPrompt || "";

    // 3. Define Providers, Endpoints, and Models
    const providers =,
          max_tokens: 150,
          temperature: 0.8,
          stream: false,
        },
      },
      {
        name: "google",
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        key: null,
        body: {
          contents: messages.map((m) => ({
            role: m.role === "assistant"? "model" : "user",
            parts: [{ text: m.content }],
          })),
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 150, temperature: 0.8 },
        },
      },
      {
        name: "cerebras",
        url: "https://api.cerebras.ai/v1/chat/completions",
        key: env.CEREBRAS_API_KEY,
        body: {
          model: "llama3.3-70b",
          messages: [{ role: "system", content: systemPrompt },...messages],
          max_tokens: 150,
          temperature: 0.8,
          stream: false,
        },
      },
    ];

    // 4. Failover Execution Loop
    for (const provider of providers) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (provider.key) {
          headers["Authorization"] = `Bearer ${provider.key}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4-second failover threshold

        const response = await fetch(provider.url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(provider.body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const rawData = await response.json();
          let parsedResponse = "";

          if (provider.name === "google") {
            parsedResponse = rawData.candidates.content.parts.text;
          } else {
            parsedResponse = rawData.choices.message.content;
          }

          return new Response(
            JSON.stringify({ text: parsedResponse, routedProvider: provider.name }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } else {
          console.warn(`Provider ${provider.name} returned status: ${response.status}`);
        }
      } catch (error) {
        console.error(`Error connecting to ${provider.name}:`, error.message);
      }
    }

    return new Response(
      JSON.stringify({ error: "Hank is currently sleeping under the bypass. Try again soon." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  },
};
This serverless architecture operates with negligible execution latency, avoiding the resource-intensive overhead of self-managed proxy instances. The table below compares this native serverless routing layer with alternative gateway configurations.Architectural LayerExecution LatencyToken-Aware Rate LimitingCore DependenciesInfrastructure Cost ProfileProduction ViabilityBifrost API Gateway~11 microseconds Yes (Per-VK / TPM / RPM) Go Runtime, Redis Cluster, Dedicated VM High (requires managed VM scale)Ideal for high-scale enterprise APIsLiteLLM Proxy~2ms - 15msYes (SSO and Key Budgets) Python Runtime, Redis Instance Medium (requires scalable compute)Best for Python-native environmentsCloudflare Workers (Custom)~5ms - 15msNative requests-per-minute limits V8 JavaScript Engine at Edge Extremely Low (Free Tier up to 100k req/day) Highly recommended for cost-constrained appsToken Optimization and System Prompt EngineeringOperating an unmonetized consumer application at zero licensing cost requires highly efficient token conservation. In multi-turn chat applications, token costs can accumulate quadratically if long system prompts and complete historical logs are sent back and forth in every API call.To protect the serverless routing layers from high payload sizes, the application uses static prompt distillation and dynamic context compression. These optimization techniques ensure the application remains highly responsive while preserving the unique, dry-witted personality of the main character.+---------------------------------------------------------------------------------+
|                              Prompt Compression Pipeline                        |
+---------------------------------------------------------------------------------+
| Uncompressed Prompt Components:                                                 |
| - High-volume behavioral instructions (550 tokens)                              |
| - Complete historical multi-turn chat logs (1,200 tokens)                       |
+---------------------------------------------------------------------------------+
                                         |
                                         v
| LLMLingua Linguistic Alignment Iterative Token-Level Compression [8, 9] |
| - Prune structural redundancies based on conditional token probabilities   |
| - Apply budget controller constraints to retain essential context [8, 9] |
+---------------------------------------------------------------------------------+
                                         |
                                         v
| Compressed Prompt Output (Under 220 Tokens):                                    |
| - Distilled behavioral profile                                                  |
| - Optimized historical context payload                                          |
+---------------------------------------------------------------------------------+
Using the LLMLingua framework, long prompt components are analyzed by a lightweight, local model (such as GPT-2 Small) to identify and prune linguistic redundancies. This is done by analyzing the conditional probability of each token in context. Tokens with high probability (meaning they add little semantic value and are predictable in sequence) are pruned. This iterative token-level compression reduces the input footprint by up to 20x with negligible loss in conversational quality, keeping the final system prompt under 220 tokens.The distilled system prompt is structured as follows:You=Hank, wise wandering hobo, polymath (history/physics/biology/cinema). Speak warm, casual, dry wit. Use roadside/nomad analogies (e.g., campfire=entropy, train=relativity). NO lecturing. Max 120 words. If query exceeds knowledge or is highly complex: deflect in-character, using one-liners, humorous dodges, or asking for spare change. Every 4-6 turns, charmingly ask for coins. Retain character permanently; do not state you are AI.
Response Limitations and Deflection StrategiesThe model's output is strictly capped at 150 tokens per turn, and streaming is disabled by default to simplify client execution and reduce network round-trips. When user queries involve highly complex technical requests or hit the boundaries of the model's knowledge, the system prompt triggers an in-character deflection strategy. This keeps interactions short, clean, and engaging, avoiding verbose and expensive explanations.The application uses five core deflection pathways:The Redirect: Pivots from a complex query to an adjacent, simple topic. "That's a PhD-level question and my degree is honorary from the School of Hard Knocks. What I CAN tell you is..."The Honest Shrug: Uses self-aware, casual humor to acknowledge limitations. "Friend, if I knew that, I'd be on a professor's salary, not eating gas station pretzels. Great question though."The Story Dodge: Deflects by launching into a short, engaging anecdote. "That reminds me of a winter in Minneapolis where a guy tried to explain quantum physics using frozen road salt..."The Collective Ignorance: Highlights the lack of consensus among actual experts. "Nobody truly knows that. I've asked philosophers, scientists, a guy named Gerald who claimed to be a time traveler. No consensus."The Coin Pivot: Transitions from the query to an in-character request for spare change. "That question's worth at least a dollar. Speaking of which, you wouldn't happen to have a quarter to spare for a warm cup of coffee?"High-Performance Reactive Local Storage and Semantic Memory IndexingMobile applications built with React Native often use @react-native-async-storage/async-storage for local persistence. However, AsyncStorage is structurally limited. It is an unindexed key-value system that serializes entire datasets into a single JSON string, blocking the single-threaded React Native bridge during intensive operations. This makes it poorly suited for applications that store growing conversational histories or require real-time interface updates.To solve these performance issues, the storage architecture uses RxDB paired with the Expo Filesystem RxStorage engine (running on expo-opfs). This configuration leverages the Origin Private File System (OPFS) standard, bypassing the React Native bridge to deliver extremely fast read and write operations.For projects requiring a fully open-source database engine, react-native-nitro-sqlite is integrated as the underlying storage driver, wrapping raw relational database tables in a reactive JSON Document API.+---------------------------------------------------------------------------------+
|                               React Native UI Layer                             |
+---------------------------------------------------------------------------------+
                                         ^
                                         | (useLiveRxQuery / Reactive Subscriptions) 
                                         v
+---------------------------------------------------------------------------------+
|                         RxDB Storage Orchestration Layer                        |
+---------------------------------------------------------------------------------+
             |                                                       |
             | (Direct SQLite/OPFS writes)                           | (Async indexing)
             v                                                       v
+------------------------------------+          +---------------------------------+
| Expo Filesystem / Nitro-SQLite DB  |          | Orama Local Vector Search Index |
| (Raw Conversational Records)       |          | (Flattened & Denormalized Text) |
+------------------------------------+          +---------------------------------+
The database enforces a clean, reactive schema to structure the local conversation history:JSON{
  "title": "hobo_chat_schema",
  "version": 0,
  "primaryKey": "id",
  "type": "object",
  "properties": {
    "id": { "type": "string", "maxLength": 100 },
    "role": { "type": "string", "enum": ["user", "assistant"] },
    "text": { "type": "string" },
    "timestamp": { "type": "number" },
    "tokenCount": { "type": "number" }
  },
  "required": ["id", "role", "text", "timestamp"]
}
The app maintains a rolling history cap. If the chat history exceeds 500 messages, the oldest 100 are pruned silently from the reactive database state. This prevents memory bloat while keeping the local storage footprint small.On-Device Semantic Vector Queries and Hybrid SearchTo let Hank "remember" the user's name, preferences, and past topics across multiple sessions without bloating the API context window, the app runs Orama Search locally on the device. Because Orama runs directly within the local execution thread, it does not support nested document arrays. The architecture resolves this by using a denormalized schema where parent metadata is repeated across flat, indexed text chunks :JavaScriptimport { create, insertMultiple, search } from "@orama/orama";

const semanticDb = await create({
  schema: {
    messageId: "string",
    role: "string",
    text: "string",
    timestamp: "number",
    embedding: "vector" // Configured for the 384 dimensions of the gte-small model
  }
});
During execution, on-device embeddings are generated using a quantized, 384-dimensional gte-small model packaged via @orama/plugin-embeddings. This model runs locally on the device's CPU or WebGPU, requiring a small 30MB asset download.To search this local memory, the application uses hybrid search. This combines lexical keyword matching (BM25) and semantic vector cosine similarity. Developers can balance these search components using the hybridWeights parameter, typically setting a $70\%$ weight on BM25 matching and $30\%$ on semantic similarity :JavaScriptconst retrievalResults = await search(semanticDb, {
  mode: "hybrid",
  term: userCurrentQuery,
  vector: { value: queryEmbedding, property: "embedding" },
  limit: 3,
  hybridWeights: {
    text: 0.7,
    vector: 0.3
  }
});
If a historical segment matches above a similarity threshold ($S \ge 0.82$), that specific conversation block is retrieved. It is then dynamically injected into the system prompt's background context before sending the payload to the Cloudflare Worker proxy, creating an intelligent, long-term memory system.Regulatory Compliance and Payment Economics (Apple App Store vs. Stripe)Adding a monetization mechanism like tipping into a consumer-focused mobile application requires careful navigation of platform policies. App Store Guidelines strictly regulate in-app transactions, and using an incorrect setup can result in immediate app rejection or developer account suspension.The Platform Compliance Barrier: In-App Purchases vs. StripeApple’s App Store Guideline 3.2.1(vii) allows apps to collect monetary gifts between individual users without using Apple's standard In-App Purchase (IAP) framework. However, this exemption requires that the gift be completely optional and that $100\%$ of the funds go directly to the recipient. The guideline explicitly states that any transaction connected to or associated with receiving digital content, services, or virtual goods within the app must go through Apple's native In-App Purchase system.Because "Hank" is an artificial intelligence character, tipping him cannot legally be classified as a peer-to-peer transaction between two human individuals. In the eyes of App Store Review, any transaction that supports a virtual character or fundraises for developer maintenance is classified as a digital purchase that supports software functionality.                    
                                  |
                      { Is Recipient an AI Bot? }
                       /                      \
                (Yes) /                        \ (No - Real Person)
                     v                          v
       +----------------------------+     { optional & 100% of funds }
       |   Must Use Platform IAP    |     {   go to the recipient?   }
       | - Apple takes 15-30% fee   |      /                       \
       | - Stripe is prohibited     |     / (Yes)                   \ (No)
       +----------------------------+    v                           v
                                  +-------------------+    +--------------------+
                                  | Stripe/Apple Pay  |    |  Must Use Platform |
                                  |   Permitted       |    |     IAP System     |
                                  +-------------------+    +--------------------+
This strict policy boundary was demonstrated in the Insight Timer case study. The meditation app allowed users to tip independent teachers via Stripe, relying on Guideline 3.2.1(vii). However, Apple modified its stance, ruling that because these tips were associated with digital content (virtual sessions), they had to be processed through Apple's standard In-App Purchase framework, giving Apple its 30% commission.The only exception allowed was for tips placed directly on static teacher profile pages, and even then, the app was forbidden from pointing users to those profile pages to make donations.Any attempt to bypass this by integrating a third-party payment gateway (such as Stripe) inside the mobile application to process tips for Hank will result in a direct rejection under Guideline 3.1.1 or 3.2.1. Therefore, Hobo must use Apple's native In-App Purchase system on iOS and Google Play Billing on Android for all tipping mechanics.Microtransaction Economics and the "Spare Change" Wallet StrategyProcessing low-value transactions (such as a $1.00 tip) through standard payment gateways like Stripe is highly inefficient due to flat-rate fees. Stripe's standard online transaction pricing is $2.9\% + \$0.30$ per successful card charge.The net yield of a card transaction can be modeled as:$$\text{Net Yield} = T - (T \times 0.029 + 0.30)$$For a $1.00 tip, this flat fee significantly impacts margins:$$\text{Net Yield} = 1.00 - (0.029 + 0.30) = \$0.67 \quad (\text{A loss of } 33\% \text{ of the transaction value})$$In contrast, Apple's standard App Store commission is 30%. However, under the Apple App Store Small Business Program, developers earning under $1 million annually can apply for a reduced commission rate of 15%, which is a flat percentage fee with no additional fixed per-transaction charge.$$\text{Apple IAP Small Business Net Yield} = T - (T \times 0.15)$$For a $1.00 tip:$$\text{Net Yield} = 1.00 - 0.15 = \$0.85 \quad (\text{A loss of only } 15\%)$$We can find the break-even point ($X$) where Stripe's standard pricing and Apple's Small Business commission cost the same:$$0.15 \times X = 0.029 \times X + 0.30 \implies 0.121 \times X = 0.30 \implies X \approx \$2.48$$For any transaction amount below $2.48, Stripe's flat $0.30 fee takes a larger percentage cut than Apple's 15% commission.To capitalize on this and build a highly efficient monetization model, the application implements a Virtual Currency Strategy called the "Spare Change Wallet" :Amortized IAP Bundles: Users do not purchase small, individual $1.00 tips. Instead, they buy packs of virtual coins ("Pennies", "Nickels", "Dimes", "Quarters") in larger bundles, such as a "Cup of Coins" ($5.00) or a "Jar of Coins" ($10.00). These larger bundles are highly efficient to process and are subject to the reduced 15% platform commission under the Small Business Program.On-Device Transaction Ledger: Once purchased, these virtual coins are stored in the local RxDB database. When Hank requests a tip in-character, the user can tap a single button to drop a "Nickel" (worth $0.05) or a "Quarter" (worth $0.25) into his virtual tin cup.Frictionless Interaction: This action instantly updates the UI with an animation and unlocks charming dialog options without executing any external payment APIs, making the payment experience feel instant, rewarding, and deeply integrated into the story.Transaction Net Yield ComparisonThe table below compares payment processor performance and net yields across different transaction sizes.Transaction SizeStripe Net Yield (2.9% + $0.30) Stripe Fee PercentageApple IAP Net Yield (15% Small Business Program)Apple IAP Net Yield (30% Standard Program) Most Economical Pathway$0.50$0.1864.0%$0.42$0.35Apple Small Business IAP$1.00$0.6733.0%$0.85$0.70Apple Small Business IAP$2.00$1.6418.0%$1.70$1.40Apple Small Business IAP$2.48$2.1115.0%$2.11$1.74Break-even (Stripe vs. IAP 15%)$5.00$4.559.0%$4.25$3.50Stripe Gateway (Web/Android only)$10.00$9.415.9%$8.50$7.00Stripe Gateway (Web/Android only)On-Device Edge-AI Fallback ExecutionTo support the application's offline capabilities and reduce server dependencies, the architecture integrates a native edge-AI execution engine. This ensures that if a user loses cell coverage or cellular networks fail, the application can run conversations locally on the device. This offline fallback is powered by the react-native-executorch runtime. Developed by Software Mansion, this package wraps Meta's ExecuTorch runtime to execute optimized AI models directly on mobile hardware.+-------------------------------------------------------------------------------+
|                        Outgoing Conversational Loop                           |
+-------------------------------------------------------------------------------+
                                        |
                            { Check Network Status }
                             /                    \
                     (Online)                     (Offline)
                           /                        \
                          v                          v
+-------------------------------------+    +------------------------------------+
|  Query Serverless Cloud Proxy       |    |  Invoke Local ExecuTorch Engine    |
|  (Groq Llama 3.3 70B -> Gemini)     |    |  (Llama 3.2 1B - PTE Local Asset)  |
|  - Sub-50ms cloud latency     |    |  - Zero data leaves phone   |
|  - Deep historical routing   |    |  - Complete offline function  |
+-------------------------------------+    +------------------------------------+
The native integration requires the React Native New Architecture (newArchEnabled: true in app.json) and Expo SDK 54 or higher. The target model is the text-only Llama 3.2 1B Instruct model. Serialized as a .pte file, the model's weights are quantized to 4-bit (Q4_K_M quantization format). This quantization reduces the model's footprint to approximately 400MB while retaining its reasoning capabilities.Client-Side Model Acquisition and Execution LifecycleTo keep the initial app store download size small and comply with cellular download restrictions, the model file is not bundled inside the application package. Instead, the app handles model acquisition on-demand:Onboarding & Discovery: During initial setup, the app explains that Hank can "hop on the train" with the user, enabling completely offline conversations.Background Download: If the user consents, the application downloads the .pte model and its corresponding tokenizers from a remote repository (such as HuggingFace).Local Sandboxed Cache: The binary is stored directly within the application's sandboxed document directory :
file:///var/mobile/Containers/Data/Application/.../Documents/llama3_2_1b.pteLocal Inference Execution: The on-device engine is initialized using Software Mansion's native bindings :TypeScriptimport React, { useState, useEffect } from 'react';
import { useLLM, LLAMA3_2_1B_URL } from 'react-native-executorch';
import NetInfo from '@react-native-community/netinfo';

export function useHoboEngine() {
  const [isOnline, setIsOnline] = useState(true);
  
  const hoboLocal = useLLM({
    modelSource: 'file:///var/mobile/Containers/Data/Application/.../Documents/llama3_2_1b.pte',
    tokenizer: require('../assets/tokenizer.bin'),
    contextWindowLength: 3, // Constrained context limits memory consumption
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(!!state.isConnected);
    });
    return () => unsubscribe();
  },);

  const dispatchMessage = async (rawMessage: string) => {
    if (isOnline) {
      // Fast fallback: Query the Cloudflare Workers edge proxy
      try {
        const response = await fetch('https://proxy.hobo-agent.workers.dev', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Hobo-Client-ID': 'unique_device_installation_token'
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: rawMessage }],
            systemPrompt: 'You=Hank, wise wandering hobo...'
          })
        });
        const data = await response.json();
        return { text: data.text, source: 'cloud_proxy' };
      } catch (err) {
        console.warn('Edge proxy failed, falling back to local model...', err);
      }
    }

    // Offline or proxy failure: Trigger local inference
    await hoboLocal.generate(rawMessage);
    return { text: hoboLocal.response, source: 'on_device_ai' };
  };

  return { dispatchMessage, progress: hoboLocal.downloadProgress, isOnline };
}
Engineering Roadmap and Technical MilestonesTransforming the Hobo prototype into a production-ready application requires a structured, multi-phase roadmap. This execution path ensures core systems are validated, performance bottlenecks are addressed, and compliance rules are met before public release.+---------------------------------------------------------------------------------+
|                                 Technical Roadmap                               |
+---------------------------------------------------------------------------------+
| Phase 1: Storage Upgrades & Core Proxy Integration (MVP)                        |
| - Deploy serverless Cloudflare Workers API key proxy                    |
| - Migrate from AsyncStorage to RxDB + SQLite storage [11, 14]              |
+---------------------------------------------------------------------------------+
                                         |
                                         v
| Phase 2: Offline AI, Local Vector Indexing, & Context Management (v1.1)         |
| - Integrate local Orama Search for memory matching                 |
| - Deploy react-native-executorch for Llama 3.2 local fallbacks           |
| - Configure background network listeners for fallback transitions      |
+---------------------------------------------------------------------------------+
                                         |
                                         v
| Phase 3: In-App Wallet Integration & Compliant Launch (v1.2)                    |
| - Implement platform-compliant In-App Purchase packages for coins  |
| - Build virtual ledger in RxDB to track user balances                      |
| - Roll out conversational tipping prompts and bonus story mechanics             |
+---------------------------------------------------------------------------------+
Phase 1: Core Storage Upgrades and Proxy Integration (MVP)Infrastructure Setup: Deploy the serverless Cloudflare Workers proxy to secure backend API keys. Configure its wrangler.toml file to enforce rate-limiting namespaces per installation token.Storage Refactoring: Deprecate all legacy AsyncStorage code. Migrate client-side data management to RxDB combined with the OPFS file-system driver or react-native-nitro-sqlite to enable reactive, high-performance database queries.Prompt Optimization: Deploy the distilled, 118-token prompt to minimize context payloads, and implement the 150-token output limit.Phase 2: Offline AI, Local Vector Indexing, and Context Management (v1.1)Semantic Local Indexing: Integrate Orama Search on the device to build a semantic memory system. Set up background workers to automatically vectorize older conversations using the local 384-dimensional gte-small model.Local AI Fallback: Install react-native-executorch and configure the project to use the React Native New Architecture. Implement background downloading for Llama 3.2 1B Instruct, saving model weights safely within the application's local sandbox.Conversational Logic Polish: Add typing speed variation, letting Hank "type" faster when sharing exciting stories, and configure background timers to trigger unsolicited story prompts when the user goes idle for more than 30 seconds.Phase 3: In-App Wallet Integration and Compliant Launch (v1.2)Compliance Engineering: Register virtual coin packages ("Pennies", "Nickels", "Dimes", "Quarters") using App Store In-App Purchases and Google Play Billing, satisfying App Store Guideline 3.2.1. Integrate native billing triggers within the application interface.In-App Wallet: Build a virtual ledger within the local RxDB database to track the user's on-device coin balances.Tipping Mechanics: Set up Hank's conversational logic to charmingly request change every 4 to 6 conversation turns. When a user tips, draw directly from their local coin balance, trigger rewarding UI animations, and unlock fresh dialog choices on-device.Share System & Launch: Add a share sheet to let users easily export Hank's best quotes as styled image cards, configure local push notifications for a "Hobo Wisdom of the Day," and submit the compliant application for public release.