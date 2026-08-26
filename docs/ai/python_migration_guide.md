# Trackers Lens --- Guida alla migrazione Electron + Runtime Python

**Destinatario:** Codex AI / sviluppatori Trackers Lens\
**Obiettivo:** trasformare progressivamente Trackers Lens in una desktop
app Electron con runtime multi-linguaggio, preservando il lavoro
esistente e introducendo Python senza una riscrittura.

**Direzione di lavoro (2026-08-25):** per ogni capability Python TL deve
integrare prima moduli Python affidabili e mantenuti dalla community o dal
fornitore. Il codice TL-specifico deve restare un adapter sottile per
contratti, lifecycle, policy, osservabilità e normalizzazione degli output;
non deve ricreare da zero embedding, reranking, NLP, ML o algoritmi
specialistici già disponibili.

------------------------------------------------------------------------

## 0. Regole operative per Codex

Prima di modificare codice:

1.  Leggi `AI.md`.
2.  Leggi `docs/ai/current-focus.md`.
3.  Per questo task sostanziale, leggi `docs/ai/project-state.md`.
4.  Leggi `docs/ai/architecture.md`.
5.  Leggi `docs/ai/file-map.md`.
6.  Leggi `docs/ai/runtime/contract.md`.
7.  Leggi `docs/ai/runtime/agent-runtime.md`.
8.  Leggi `docs/ai/runtime/ai-memory.md`.
9.  Leggi solo la documentazione dei moduli realmente coinvolti.
10. Leggi `docs/ai/task-registry.md` solo quando cambia lo stato dei
    task.
11. Non leggere gli archivi salvo necessità storica esplicita.

Il repository è la fonte di verità. I nomi di moduli, directory,
manifest, payload e canali mostrati qui sono **indicazioni
architetturali**, non autorizzano a inventare file o contratti
inesistenti.

Prima di una modifica architetturale Codex deve restituire:

-   mappa dell'implementazione attuale;
-   file realmente coinvolti;
-   contratti da preservare;
-   dati persistenti a rischio;
-   piano della fase;
-   test;
-   strategia di rollback.

**Non iniziare con una riscrittura generale.**

------------------------------------------------------------------------

## 0.1 Politica per il primo sviluppo

Trackers Lens è attualmente in **primo sviluppo**, senza utenti finali o
workflow di produzione da migrare. Quando il proprietario del progetto approva
il passaggio di una capability da JavaScript a un modulo Python gestito, Codex
deve eseguire il cutover diretto:

- mantenere i contratti e i dati che TL continua a possedere;
- rimuovere implementazioni, selettori, fallback e UI di migrazione obsoleti;
- non inventare rollout per utenti, compatibilità artificiale o azioni
  "migra il tuo nodo";
- lasciare test ripetibili e documentazione della capability scelta.

Rollback e doppie implementazioni si usano solo se richiesti esplicitamente dal
proprietario o se proteggono dati persistenti reali. Non sono un motivo per
mantenere codice morto durante il primo sviluppo.

------------------------------------------------------------------------

# 1. Decisione architetturale

Trackers Lens deve evolvere verso:

``` text
Trackers Lens
├── Electron Desktop Shell
├── UI esistente / CMSwift
├── TL Core / Runtime JS-Node esistente
├── Runtime Manager
├── JavaScript Workers
├── Managed Python Runtime
├── Python Node SDK
└── Persistent Storage controllato da TL
```

Non fare:

``` text
Trackers Lens JS
      ↓
riscrittura
      ↓
Trackers Lens Python
```

Fare:

``` text
Trackers Lens attuale
      +
Electron
      +
runtime multi-linguaggio
      +
Python progressivo
```

Python è una nuova capacità di TL, non il sostituto di TL.

------------------------------------------------------------------------

# 2. Principio fondamentale: preservare il lavoro esistente

Trackers Lens è già avanzato. La migrazione deve considerare il codice
attuale come un asset.

Devono continuare a funzionare, salvo modifiche esplicitamente
versionate:

-   Flow Map;
-   Flow Chat;
-   CMSwift UI;
-   nodi JS;
-   runtime esistente;
-   canali/event bus;
-   providers;
-   agents;
-   jobs;
-   Runtime DevTools;
-   Memory;
-   Knowledge Graph;
-   Graph Query;
-   RAG / AI Graph Answer;
-   workspace;
-   template/pattern;
-   configurazioni;
-   dati utente;
-   flow salvati.

Regola:

> Prima rendere compatibile. Poi migliorare. Solo alla fine,
> eventualmente, deprecare.

------------------------------------------------------------------------

# 3. Responsabilità dei componenti

## Trackers Lens Core

TL Core rimane l'autorità.

Gestisce:

-   workspace;
-   Flow;
-   Node registry;
-   contratti;
-   Bus/canali/eventi;
-   job;
-   agenti;
-   permissions;
-   policy;
-   storage API;
-   memory policy;
-   knowledge policy;
-   provider orchestration;
-   observability;
-   audit;
-   lifecycle dei runtime.

## JavaScript / Node.js

Rimane particolarmente adatto a:

-   orchestrazione;
-   real-time;
-   Flow execution;
-   eventi;
-   API;
-   process supervision;
-   desktop integration;
-   Node lifecycle;
-   extension/connector;
-   UI bridge.

## Python

Diventa il runtime cognitivo/scientifico specializzato per:

-   NLP;
-   embeddings;
-   semantic search;
-   reranking;
-   RAG;
-   entity extraction;
-   coreference;
-   semantic roles;
-   relation extraction;
-   event extraction;
-   graph algorithms;
-   ML;
-   Transformers;
-   statistiche;
-   data science;
-   scientific computing;
-   vision;
-   audio;
-   modelli locali.

Python esegue moduli e modelli scelti per una capability; TL non deve
duplicarne gli algoritmi. TL conserva invece l'autorità su installazione,
versioni, permessi, scope, dati, provenance, fallback e lifecycle.

## Database

Il database **non appartiene a Python**.

``` text
Python = calcola / analizza / propone
TL Core = autorizza / governa / persiste
DB = memoria persistente controllata da TL
```

------------------------------------------------------------------------

# 4. Architettura target

``` text
┌─────────────────────────────────────────────────────────────┐
│                    TRACKERS LENS APP                        │
│                         Electron                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Renderer                                              │  │
│  │ CMSwift                                               │  │
│  │ Flow Map • Flow Chat • DevTools • Memory • Knowledge │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ secure bridge                    │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │ Electron Main / Desktop integration                  │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │    TL CORE      │
                  │ JS / Node.js    │
                  │                │
                  │ Bus            │
                  │ Flow Runtime   │
                  │ Agents         │
                  │ Jobs           │
                  │ Permissions    │
                  │ Storage API    │
                  │ Runtime Manager│
                  └────┬───────┬───┘
                       │       │
              ┌────────▼─┐   ┌─▼─────────────────┐
              │JS Workers│   │ Python Runtime    │
              │esistenti │   │ persistente       │
              └──────────┘   └──────┬────────────┘
                                    │
                    ┌───────────────┼──────────────┐
                    ▼               ▼              ▼
                  NLP/RAG       ML/Vectors    Science/Data
                                    │
                           TL controlled APIs
                                    │
                           ┌────────▼────────┐
                           │ Persistent Data │
                           └─────────────────┘
```

Electron è la shell desktop. Non deve diventare il posto dove vive tutta
la business logic.

------------------------------------------------------------------------

# 5. Perché Electron

Electron è la scelta primaria perché permette di riutilizzare gran parte
del lavoro JS/Node/CMSwift.

Obiettivi:

-   riutilizzare UI;
-   mantenere CMSwift;
-   mantenere Flow Map;
-   usare Node.js;
-   accesso controllato al filesystem/OS;
-   supervisionare processi Python;
-   packaging desktop;
-   local-first;
-   sviluppo rapido.

Non introdurre Tauri/Rust durante questa migrazione.

------------------------------------------------------------------------

# 6. Separazione Electron

## Renderer

Contiene la UI:

-   CMSwift;
-   Flow Map;
-   Flow Chat;
-   Runtime DevTools;
-   Memory Inspector;
-   Knowledge Graph;
-   Node Library;
-   Settings.

Non deve avere accesso diretto indiscriminato a Node.js, filesystem,
database o Python.

## Main process

Responsabile di:

-   lifecycle app;
-   finestre;
-   menu;
-   dialog OS;
-   notifiche;
-   bridge IPC;
-   eventuale supervisione dei servizi locali;
-   packaging/update infrastructure.

Non mettere qui RAG, Knowledge Graph, Memory o logica agentica.

## Preload / secure bridge

Esporre API ristrette e validate.

Esempio concettuale:

``` js
window.trackers.workspace.open(...)
window.trackers.runtime.execute(...)
window.trackers.events.subscribe(...)
```

Non esporre direttamente:

``` text
fs
child_process
database handle
arbitrary IPC
arbitrary Python execution
```

Applicare isolamento del contesto, validazione IPC e Content Security
Policy secondo l'architettura Electron effettivamente adottata.

------------------------------------------------------------------------

# 7. Fase 0 --- Baseline prima di cambiare architettura

Prima di Electron/Python:

1.  mappare entry point attuali;
2.  mappare runtime;
3.  mappare Node contract;
4.  mappare canali;
5.  mappare storage;
6.  mappare workspace format;
7.  mappare Memory;
8.  mappare Knowledge Graph;
9.  mappare provider/agent/job;
10. eseguire test esistenti;
11. creare smoke test dove mancano;
12. creare tag/branch di rollback.

Verificare almeno:

``` text
Flow create/edit
Node create/configure
Node connect
Flow execution
Flow Chat
Runtime DevTools
Memory
Knowledge Graph
Graph Query
AI Graph Answer
workspace save/load
template/pattern
provider
agent/job
```

Exit criteria:

-   TL corrente è ripristinabile;
-   comportamento critico ha regression coverage;
-   dati persistenti sono conosciuti.

------------------------------------------------------------------------

# 8. Strategia di migrazione: Strangler Pattern

Non sostituire tutto insieme.

``` text
TL attuale
   ↓
Electron ospita UI attuale
   ↓
JS runtime continua a funzionare
   ↓
si introduce Runtime Manager
   ↓
si introduce Python Worker
   ↓
un Node Python di prova
   ↓
Python Node SDK
   ↓
1 capacità AI reale
   ↓
migrazione selettiva
```

Ogni fase deve lasciare TL utilizzabile.

------------------------------------------------------------------------

# 9. Fase 1 --- Electron shell

Obiettivo: eseguire TL come desktop app **senza cambiare il
funzionamento interno**.

Fare:

-   bootstrap Electron;
-   main process;
-   preload;
-   renderer con UI esistente;
-   mantenere CMSwift;
-   mantenere Flow Map;
-   mantenere modalità web/dev se utile;
-   definire app-data paths;
-   gestire lifecycle corretto.

Preferire:

``` text
stessa UI
├── browser/dev
└── Electron renderer
```

Non creare due frontend indipendenti.

Exit criteria:

-   TL si apre come app desktop;
-   feature attuali funzionano;
-   dati non si perdono.

------------------------------------------------------------------------

# 10. Fase 2 --- Boundary TL Core

Electron non deve diventare un monolite.

Target:

``` text
Renderer
   ↓
validated bridge
   ↓
TL Core
   ↓
runtime/storage
```

Il renderer non deve gestire direttamente Python worker o DB.

Il TL Core deve poter esistere concettualmente anche senza finestra
Electron, preparando in futuro:

``` text
Desktop
VS Code
Browser connector
CLI
```

come client dello stesso runtime.

------------------------------------------------------------------------

# 11. Fase 3 --- Contratto Node indipendente dal linguaggio

Questa è una delle decisioni più importanti.

Il Node deve essere una **capacità TL**, non una classe JavaScript.

Manifest concettuale:

``` json
{
  "id": "semantic-reranker",
  "version": "1.0.0",
  "runtime": "python",
  "entry": "...",
  "inputs": {},
  "outputs": {},
  "permissions": [],
  "dependencies": {}
}
```

I vecchi Node JS devono continuare a funzionare.

Se il vecchio manifest non ha `runtime`, usare un adapter/default
compatibile con il comportamento attuale.

## Execution request concettuale

``` json
{
  "executionId": "...",
  "nodeId": "...",
  "runtime": "python",
  "inputs": {},
  "context": {
    "workspaceId": "...",
    "flowId": "...",
    "jobId": "..."
  }
}
```

## Result concettuale

``` json
{
  "executionId": "...",
  "status": "success",
  "outputs": {},
  "metrics": {
    "latencyMs": 0
  },
  "diagnostics": []
}
```

Adattare ai contratti reali.

Il contratto deve poter rappresentare:

-   input/output;
-   execution ID;
-   progress;
-   log;
-   error;
-   cancellation;
-   timeout;
-   metrics;
-   permissions;
-   provenance;
-   workspace/flow scope.

------------------------------------------------------------------------

# 12. Runtime Manager

Integrare con i runtime esistenti; non duplicarli.

Responsabilità:

``` text
Runtime Manager
├── JavaScript executor
├── Python executor
├── worker registry
├── health
├── capability registry
├── execution routing
├── cancellation
├── timeout
├── crash recovery
└── metrics
```

Routing:

``` text
Flow Runtime
   ↓
Node execution
   ↓
Runtime Manager
   ├── javascript → executor JS
   └── python     → executor Python
   ↓
risultato normalizzato
   ↓
Bus TL esistente
```

------------------------------------------------------------------------

# 13. Python come runtime persistente

Non fare:

``` text
ogni evento
→ spawn python
→ import librerie
→ run
→ exit
```

Fare:

``` text
TL start
  ↓
Python Runtime start
  ↓
worker rimane vivo
  ↓
esegue molti job
  ↓
mantiene cache/modelli
  ↓
TL shutdown
  ↓
shutdown Python
```

Questo è essenziale per ML/embeddings/modelli.

------------------------------------------------------------------------

# 14. Protocollo TL ↔ Python

Deve essere:

-   versionato;
-   language-neutral;
-   testabile;
-   osservabile;
-   cancellabile;
-   cross-platform.

Valutare trasporto:

-   Unix domain socket;
-   Windows named pipe;
-   IPC locale;
-   RPC adatto.

Valutare:

-   macOS;
-   Windows;
-   Linux se supportato;
-   streaming;
-   payload grandi;
-   binary;
-   cancellation;
-   sicurezza;
-   debugging;
-   latenza.

Prima definire il **contratto logico**, poi il trasporto.

------------------------------------------------------------------------

# 15. Primo Proof of Concept Python

Non iniziare da Knowledge Graph.

Creare:

``` text
Input
 ↓
Python Test Node
 ↓
trasformazione banale
 ↓
Output
 ↓
Preview
```

Percorso completo:

``` text
Flow Map
→ TL Runtime
→ Runtime Manager
→ Python Worker
→ Runtime Manager
→ Bus
→ Preview
```

Testare:

-   success;
-   invalid input;
-   exception;
-   progress;
-   log;
-   timeout;
-   cancellation;
-   worker crash;
-   worker restart;
-   concorrenza.

Solo dopo passare a AI reale.

------------------------------------------------------------------------

# 16. Python Node SDK

Dopo il POC creare un SDK minimale.

Esempio concettuale:

``` python
from trackers_lens import node

@node(
    id="semantic-reranker",
    inputs=["query", "documents"],
    outputs=["ranked_documents"]
)
def run(ctx, inputs):
    ...
```

Prima versione:

``` text
inputs
outputs
ctx.log
ctx.progress
ctx.cancelled
execution context
```

Poi, progressivamente e con permissions:

``` text
ctx.memory.search
ctx.knowledge.query
ctx.knowledge.propose
ctx.workspace.read
ctx.emit
```

Non dare accesso totale.

## Adapter TL sopra moduli Python

Un Node Python di TL non deve implementare da zero la capacità offerta da
una libreria esistente. Il Node contiene un adapter piccolo e verificabile:

``` text
input Flow normalizzato
→ adapter TL Python
→ modulo Python dichiarato dal manifest
→ output/evidence/metriche normalizzati
→ TL Core autorizza, osserva e persiste
```

L'adapter valida input/output, rispetta cancellazione e timeout, espone
progress/log e costruisce provenance. Il modulo esterno resta responsabile del
calcolo specialistico. Ogni nuovo Node deve documentare modulo candidato,
licenza, footprint CPU/GPU, compatibilità offline, benchmark e fallback prima
di introdurre codice proprietario equivalente.

------------------------------------------------------------------------

# 17. Capabilities invece di linguaggi

Gli agenti non devono ragionare in termini di Python.

Non:

``` text
usa Python per analizzare i dati
```

Ma:

``` text
capability: statistical_analysis
```

TL risolve:

``` text
statistical_analysis
      ↓
Node registrato
      ↓
Python Runtime
      ↓
libreria appropriata
```

Così domani l'implementazione può cambiare senza cambiare l'agente.

------------------------------------------------------------------------

# 18. Introduzione progressiva di Python nei Nodi

## Stage A --- operazioni isolate

Prima:

-   text utility;
-   data transform;
-   semplice graph utility.

Scopo: stabilizzare runtime/protocollo.

## Stage B --- Embeddings / Reranking

Prime capacità AI consigliate:

1.  Embedding Generator;
2.  Semantic Reranker.

Sono isolate, misurabili e beneficiano dell'ecosistema Python.

Misurare:

-   qualità;
-   latenza;
-   memoria;
-   cold/warm start;
-   stabilità.

## Stage C --- NLP avanzato

Dopo stabilità:

-   entity extraction;
-   coreference;
-   semantic role labeling;
-   relation extraction;
-   event extraction;
-   language analysis.

Non cambiare necessariamente il Node esterno.

Esempio:

``` text
Knowledge Event Builder
       │
       ├── lifecycle/contract TL esistente
       └── NLP engine → Python
```

## Stage D --- RAG

Python può progressivamente gestire:

-   embeddings;
-   vector search;
-   hybrid retrieval;
-   reranking;
-   context compression;
-   semantic query expansion.

TL continua a governare:

-   scope;
-   permission;
-   persistence;
-   provenance;
-   policy.

## Stage E --- Knowledge Graph

Python può aggiungere:

-   alias/entity resolution;
-   graph algorithms;
-   path analysis;
-   clustering;
-   causal analysis;
-   relation scoring;
-   temporal/event analysis.

Non migrare automaticamente il DB del Knowledge Graph a Python.

## Stage F --- Science / ML / specialist Nodes

Poi:

-   NumPy;
-   Pandas;
-   SciPy;
-   scikit-learn;
-   NetworkX;
-   PyTorch;
-   Transformers;
-   sentence-transformers;
-   vision;
-   audio;
-   bioinformatics.

Sono esempi: installare solo ciò che serve.

------------------------------------------------------------------------

# 19. Database: ownership TL

Regola critica:

> Python non possiede il database principale di Trackers Lens.

Preferire:

``` text
Python Node
    ↓
TL Memory / Knowledge / Storage API
    ↓
TL Core
    ↓
DB
```

Vantaggi:

-   permissions;
-   schema centralizzato;
-   migrations;
-   audit;
-   sostituibilità del DB;
-   sicurezza Marketplace.

Python può essere il motore operativo di storage specialistici dietro
servizi TL.

Esempio:

``` text
TL Vector Service
   ↓
Python
   ↓
FAISS / altro engine
```

Ownership logico: TL.

------------------------------------------------------------------------

# 20. Knowledge Candidate Policy

Separare:

``` text
inference
candidate
validated knowledge
persistent knowledge
```

Esempio:

``` text
Python inferisce:
A causes B
confidence 0.63
        ↓
Knowledge Candidate
        ↓
TL validation/policy
        ↓
accept / reject / pending
        ↓
Knowledge Graph
```

Python può proporre conoscenza; TL decide se consolidarla.

DevTools dovrebbe poter mostrare:

``` text
Candidate
Source Node
Runtime
Method/model
Evidence
Confidence
Status
```

------------------------------------------------------------------------

# 21. Permissions

Preparare permissions capability-based, compatibili con il sistema
esistente.

Esempi concettuali:

``` text
memory:read
memory:write
knowledge:read
knowledge:propose
vectors:search
workspace:read
workspace:write
network:http
process:execute
model:load
```

I Node della community devono partire dal minimo privilegio.

Non consegnare il path fisico del DB principale ai Node Marketplace.

------------------------------------------------------------------------

# 22. Python gestito da TL

L'utente normale non dovrebbe fare:

``` text
install Python
create venv
pip install...
```

Target:

``` text
Install Trackers Lens
→ Python Runtime disponibile/gestito
```

Struttura concettuale:

``` text
Trackers Lens
└── runtimes
    ├── javascript
    └── python
        ├── interpreter
        ├── core
        └── environments
```

Validare packaging per:

-   macOS arm64/x64 necessari;
-   Windows;
-   Linux se supportato.

------------------------------------------------------------------------

# 23. Dependency management Python

Non creare un gigantesco environment con tutte le librerie AI.

Possibile strategia:

``` text
python/core
python/envs/nlp
python/envs/scientific
python/envs/vision
python/envs/audio
python/envs/plugin-xyz
```

Valutare:

-   venv;
-   lockfile;
-   wheels;
-   native dependencies;
-   cache;
-   offline/local-first;
-   disk usage;
-   environment reuse;
-   cleanup;
-   version conflicts.

Le dipendenze non sono una scelta nascosta dell'adapter. Un Node dichiara nel
proprio manifest i requisiti Python necessari, ma non installa pacchetti da
solo e non esegue `pip` nel renderer o nel worker. TL Runtime Manager risolve
la dichiarazione contro ambienti/lockfile gestiti, verifica le versioni e
registra ambiente e provenienza nella diagnostica di esecuzione.

Se il modulo non è presente, TL mostra un piano esplicito: usare un pack già
disponibile localmente, installare un pack verificato con consenso utente
oppure rendere la capability non disponibile con fallback. Nessun download o
installazione di rete è implicito; i moduli esterni richiedono provenienza,
lockfile/checksum quando disponibili, licenza e policy di trust.

------------------------------------------------------------------------

# 24. Manifest multi-runtime

Esempio futuro concettuale:

``` yaml
id: semantic-reranker
version: 1.0.0
runtime: python
entry: main.py

capabilities:
  - semantic_reranking

inputs:
  query: string
  documents: array

outputs:
  ranked_documents: array

dependencies:
  python:
    environment: nlp
    requirements:
      - name: required-package
        version: "==1.2.3"
    lockfile: requirements.lock
    installPolicy: managed-required

permissions:
  - knowledge:read
```

Adattare al manifest reale.

`dependencies.python` descrive il modulo o pack richiesto, ma non concede
accesso diretto al package manager. Il runtime può eseguire il Node soltanto
quando TL ha risolto tali requisiti in un ambiente approvato. Per Node
built-in il requisito punta a un pack distribuito con TL; per package developer
o marketplace la provenienza e il livello di trust devono essere visibili.

Compatibilità:

-   vecchi JS Node continuano;
-   runtime mancante → comportamento JS attuale;
-   ID Node stabili;
-   port IN/OUT stabili quando possibile;
-   flow salvati validi.

------------------------------------------------------------------------

# 25. Payload grandi

JSON va bene per controllo, meno per:

-   embeddings;
-   immagini;
-   audio;
-   tensor;
-   documenti enormi.

Non complicare subito il POC, ma preparare il protocollo a
riferimenti/handle.

Esempio concettuale:

``` json
{
  "payloadRef": "runtime://temporary-resource"
}
```

Evitare copie ripetute di centinaia di MB.

------------------------------------------------------------------------

# 26. Streaming / Progress

Un Python Node può lavorare a lungo.

Supportare:

``` text
started
progress
partial
log
warning
completed
failed
cancelled
```

Usare il sistema eventi/DevTools TL esistente.

Non creare un secondo universo di logging.

------------------------------------------------------------------------

# 27. Cancellation / timeout

Ogni esecuzione deve avere:

-   executionId;
-   cancel;
-   timeout;
-   graceful cancel;
-   forced termination fallback;
-   cleanup.

Un worker bloccato non deve congelare Electron.

------------------------------------------------------------------------

# 28. Worker health

Runtime Manager dovrebbe conoscere:

``` text
workerId
runtime
process/PID
status
startedAt
heartbeat
activeJobs
memory
CPU se pratico
restartCount
lastError
capabilities
```

Se Python crasha:

``` text
worker crash
→ job = failed
→ diagnostica
→ restart policy
→ TL resta vivo
```

------------------------------------------------------------------------

# 29. Model Manager

Non ricaricare modelli enormi a ogni Node.

Preparare un registry/cache:

``` text
Model Manager
├── embedding model
├── reranker
├── NLP model
└── specialist model
```

Tracciare:

-   ID/versione;
-   device;
-   memory;
-   loaded;
-   last used;
-   runtime.

------------------------------------------------------------------------

# 30. CPU/GPU

In futuro esporre capability:

``` text
CPU
Apple Silicon backend supportato
CUDA
altri backend realmente supportati
```

Node:

``` text
requires GPU
prefers GPU
CPU compatible
```

GPU non deve essere obbligatoria per la prima beta.

------------------------------------------------------------------------

# 31. Observability

Python non deve diventare una scatola nera.

DevTools deve poter correlare:

``` text
Node
runtime
worker
execution
workspace
flow
start/end
duration
memory
CPU
model
logs
warnings
errors
dependency env
```

Per Knowledge/RAG:

``` text
entities
relations
events
evidence
confidence
retrieval counts
embedding model
reranker
context size
```

------------------------------------------------------------------------

# 32. Security

Python community code equivale potenzialmente a arbitrary code
execution.

Rischi:

-   filesystem;
-   secrets;
-   network exfiltration;
-   subprocess;
-   destructive writes;
-   persistence;
-   supply chain.

Progressione:

## Development

Solo Node Python built-in/trusted.

## Beta

Built-in + developer Node con warning/permissions.

## Marketplace

Prima di codice arbitrario servono isolamento, trust/signing e
permission model sufficienti.

Non dichiarare "sandboxed" ciò che non è realmente sandboxed.

------------------------------------------------------------------------

# 33. Security Electron

Mai:

``` text
Renderer → arbitrary Python
```

Sempre:

``` text
Renderer
→ comando TL validato
→ TL Core
→ Runtime Manager
→ Node registrato
```

Stesso principio per shell/process execution.

------------------------------------------------------------------------

# 34. Networking

Network non deve essere implicito.

``` text
local embedding → no network
graph analysis → no network
API connector → network permission
model download → explicit operation
```

------------------------------------------------------------------------

# 35. Packaging desktop

Il pacchetto finale deve gestire:

``` text
Electron
renderer
TL Core
JS runtime
Python runtime
Python SDK
built-in environments minimi
migrations
runtime manifests
resources
```

Non includere tutti i modelli/librerie ML nel base installer.

Preferire capability pack opzionali quando utile.

------------------------------------------------------------------------

# 36. App data

In produzione non usare path del repository.

Definire directory piattaforma-safe per:

``` text
workspaces
database
runtime state
logs
python env
models
cache
temp
plugins
templates
backup
```

Migrare i dati esistenti: non partire con DB vuoto.

------------------------------------------------------------------------

# 37. Migrazione dati esistenti

Prima della beta Electron:

1.  localizzare tutti i dati;
2.  identificare schema/versione;
3.  backup;
4.  migration versionata;
5.  migration idempotente dove possibile;
6.  test;
7.  recovery.

Mai eliminare silenziosamente:

-   flow;
-   Node;
-   Memory;
-   Knowledge Graph;
-   template;
-   settings;
-   provider configuration;
-   dati utente.

------------------------------------------------------------------------

# 38. Compatibilità Flow

Un Flow vecchio deve continuare a funzionare.

Esempio:

``` text
vecchio Node senza runtime
        ↓
compatibility resolver
        ↓
javascript
```

Python è opt-in durante la transizione.

------------------------------------------------------------------------

# 39. Compatibilità Memory/Knowledge

Non riscrivere i dati per comodità di Python.

Prima creare adapter Python verso contratti esistenti.

Se serve nuovo schema:

``` text
old
→ versioned migration
→ new
```

con backup e test.

------------------------------------------------------------------------

# 40. Feature Flags

Usare feature flag centralizzate secondo l'architettura TL.

Concettualmente:

``` text
electronDesktop
multiRuntime
pythonRuntime
pythonNodes
pythonEmbeddings
pythonReranker
pythonKnowledgeExperimental
```

Permettono rollback e beta progressiva.

------------------------------------------------------------------------

# 41. Dual implementation

Per componenti importanti:

``` text
engine = javascript
engine = python
```

stesso contratto IN/OUT.

Confrontare.

Solo dopo stabilità decidere deprecazione.

------------------------------------------------------------------------

# 42. Quando migrare un Node

Migrare se:

-   Python offre libreria/capability significativamente migliore;
-   qualità migliora;
-   serve ML/science;
-   manutenzione migliora;
-   JS è realmente limitante.

Non migrare se:

-   JS funziona bene;
-   Python non dà vantaggio;
-   rischio \> beneficio.

------------------------------------------------------------------------

# 43. Primi Node Python reali consigliati

Ordine:

1.  test Node banale;
2.  Embedding Generator;
3.  Semantic Reranker;
4.  graph utility isolata;
5.  Coreference Resolver;
6.  Entity Extractor;
7.  Semantic Role Analyzer;
8.  Relation Enricher;
9.  Event Builder internals;
10. hybrid RAG components.

Non iniziare dal componente più interconnesso.

Per ciascuno scegliere e validare prima un modulo Python esistente, invece di
sviluppare l'algoritmo da zero. Il primo Node reale deve quindi includere un
adapter TL, un requisito manifest/lock risolvibile dal Runtime Manager e un
fallback esplicito, oltre al benchmark della capability.

------------------------------------------------------------------------

# 44. Knowledge Graph + RAG target

``` text
Document
 ↓
Parser
 ↓
Chunking
 ↓
Dictionary
 ↓
Entity Extraction
 ↓
Coreference
 ↓
Semantic Roles
 ↓
Relations
 ↓
Events
 ↓
Knowledge Candidates
 ↓
TL Validation
 ↓
Knowledge Graph
 ↓
Embeddings / Vector Index
 ↓
Hybrid Graph + Vector Retrieval
 ↓
Reranker
 ↓
Evidence Package
 ↓
Agent
 ↓
Answer + Trace
```

Ogni step usa il runtime più adatto.

------------------------------------------------------------------------

# 45. Regola di scelta del runtime

``` text
UI                         → JS/CMSwift
orchestrazione real-time   → Node.js
Flow lifecycle             → TL Core
NLP/ML                     → spesso Python
statistica/scienza         → Python
AI reasoning               → LLM
deterministic computation  → codice/tool
persistence authority      → TL Core
```

Principio:

> Use AI where reasoning is needed. Use computation where computation is
> enough.

------------------------------------------------------------------------

# 46. Agents

Gli agenti vedono capability:

``` text
search_papers
extract_data
statistical_analysis
graph_analysis
verify_evidence
```

Non:

``` text
run python script
```

TL risolve capability → Node → runtime.

------------------------------------------------------------------------

# 47. Skills

Una Skill TL può evolvere in:

``` text
Skill
├── instructions
├── tools
├── Node capabilities
├── memory policy
├── knowledge sources
├── permissions
├── evaluation
└── model preferences
```

I Python Node sono strumenti delle Skills, non semplici prompt.

------------------------------------------------------------------------

# 48. AI Team target

``` text
Objective
   ↓
Orchestrator
   ├── Research Agent → search/RAG
   ├── Data Agent → Python data tools
   ├── Statistician → scientific tools
   ├── Graph Analyst → graph tools
   ├── Critic → evidence tools
   └── Writer → synthesis
```

Condividono:

``` text
Workspace
Memory
Knowledge
Tasks
Events
Artifacts
Evidence
Permissions
```

Tutto osservabile.

------------------------------------------------------------------------

# 49. Marketplace

Multi-runtime rende il Marketplace un ecosistema di capacità.

Esempi:

``` text
Website → Markdown       JS/Python
Scientific Parser        Python
YouTube Monitor          JS
Image Classifier         Python
Statistical Analyzer     Python
REST Connector           JS
Graph Analyzer           Python
Local Embeddings         Python
```

Metadata futuri:

``` text
runtime
version
author
permissions
dependencies
platforms
capabilities
trust/signature
resource requirements
network requirement
```

Non costruire tutto il Marketplace prima di stabilizzare il contratto.

------------------------------------------------------------------------

# 50. VS Code

Dopo desktop/runtime:

``` text
VS Code Extension
       ↕
Trackers Lens Runtime
```

VS Code può offrire:

-   workspace;
-   Git;
-   diagnostics;
-   tests;
-   terminal;
-   symbols;
-   editor context.

TL offre:

-   Flow;
-   AI teams;
-   Memory;
-   Knowledge;
-   DevTools.

Obiettivo importante:

> Trackers Lens deve poter essere usato per sviluppare Trackers Lens.

------------------------------------------------------------------------

# 51. Browser

Non serve un fork Chromium in questa migrazione.

Trattare il browser come connector:

``` text
Browser Extension
→ DOM / page / network / API context
→ TL Runtime
```

Architettura:

``` text
TL Runtime
├── Desktop
├── VS Code Connector
├── Browser Connector
└── CLI
```

------------------------------------------------------------------------

# 52. Developer Experience

Mantenere:

-   hot reload UI;
-   debug Node;
-   debug Python;
-   log separati ma correlabili;
-   startup con pochi comandi;
-   niente rebuild completo Electron per ogni modifica UI.

------------------------------------------------------------------------

# 53. Testing

## Unit

-   manifest normalization;
-   runtime selection;
-   protocol;
-   permission;
-   SDK;
-   cancellation;
-   error mapping.

## Integration

``` text
TL Core → Python Worker → Node → Result
```

Test:

-   success;
-   invalid input;
-   exception;
-   timeout;
-   cancellation;
-   crash;
-   restart;
-   concurrency.

## Electron

-   startup;
-   preload;
-   workspace;
-   renderer reload;
-   close;
-   shutdown runtime;
-   persistence.

## Regression

Tutti i Flow JS importanti.

## Cross-platform

Le piattaforme realmente supportate dalla beta.

------------------------------------------------------------------------

# 54. Benchmark

Prima di sostituire JS:

``` text
startup
cold latency
warm latency
RAM
CPU
throughput
transfer overhead
quality
error rate
```

Per RAG:

``` text
retrieval quality
reranking
evidence coverage
unsupported claims
context size
token usage
latency
```

Python non è automaticamente più veloce; il vantaggio principale è
l'ecosistema e l'accesso a implementazioni native/ML mature.

------------------------------------------------------------------------

# 55. Strategia Beta

Non aspettare la migrazione totale.

## Beta A

``` text
Electron Desktop
JS runtime stabile
feature esistenti
Python Experimental
1–3 Python Nodes
```

## Beta B

``` text
Python Runtime stabile
Embeddings
Reranking
DevTools migliorato
dependency manager
```

## Beta C

``` text
Knowledge/RAG Python selettivo
Python SDK preview
trusted developer Nodes
```

## Dopo

``` text
Marketplace Python
isolamento avanzato
AI Team ecosystem
```

------------------------------------------------------------------------

# 56. Rollback

Ogni fase deve essere reversibile.

Possibili rollback:

-   feature flag off;
-   Python worker off;
-   Node torna a engine JS;
-   schema restore;
-   app usa runtime precedente.

Python deve essere opzionale per i vecchi Flow durante la transizione.

------------------------------------------------------------------------

# 57. Failure isolation

``` text
Python Node crash
    ↓
execution failed
    ↓
errore Flow
    ↓
DevTools
    ↓
restart worker
```

TL/Electron rimane vivo.

Renderer crash non deve corrompere storage.

------------------------------------------------------------------------

# 58. Logging

Structured log correlabile:

``` text
timestamp
level
runtime
workerId
workspaceId
flowId
nodeId
executionId
message
errorCode
duration
```

Python entra nello stesso sistema di observability TL.

------------------------------------------------------------------------

# 59. Error model

Normalizzare errori tra runtime, rispettando convenzioni esistenti.

Categorie concettuali:

``` text
INVALID_INPUT
DEPENDENCY_MISSING
PERMISSION_DENIED
RUNTIME_UNAVAILABLE
EXECUTION_TIMEOUT
EXECUTION_CANCELLED
NODE_EXCEPTION
WORKER_CRASHED
MODEL_UNAVAILABLE
RESOURCE_EXHAUSTED
PROTOCOL_ERROR
```

------------------------------------------------------------------------

# 60. Versioning

Versionare:

-   runtime protocol;
-   Node manifest;
-   Python SDK;
-   storage schema;
-   migrations.

Rilevare incompatibilità prima di eseguire.

------------------------------------------------------------------------

# 61. Update separation

In futuro distinguere:

``` text
App update
Runtime update
Python environment update
Node update
Model update
```

Non trasformare ogni aggiornamento in una reinstallazione distruttiva.

------------------------------------------------------------------------

# 62. Backup

Prima di migration:

-   backup;
-   verifica;
-   schema version;
-   recovery metadata.

Local-first significa proteggere seriamente i dati locali.

------------------------------------------------------------------------

# 63. Secrets

Durante Electron migration controllare gestione:

-   API key;
-   token;
-   credentials.

Non lasciarli in normale workspace JSON se evitabile.

Python Node riceve solo secret autorizzati/scoped.

------------------------------------------------------------------------

# 64. Multi-runtime futuro

Non progettare:

``` text
JS vs Python
```

ma:

``` text
Node Contract
   ↓
Runtime Adapter
   ├── javascript
   ├── python
   └── future
```

Futuro possibile:

``` text
WASM
Docker
remote
shell
Rust
Go
MCP
```

Non implementarli ora.

------------------------------------------------------------------------

# 65. Boundary repository concettuali

Non creare questi path se esistono già equivalenti.

``` text
desktop/
core/runtime/
runtime/adapters/
python-runtime/
python-sdk/
shared/contracts/
tests/
```

Prima usare `docs/ai/file-map.md` e repository reale.

------------------------------------------------------------------------

# 66. Milestone 1

**Obiettivo:** TL Electron + un Python Node, senza rompere JS.

Acceptance:

``` text
1. Start Electron.
2. Existing Flow opens.
3. JS Nodes run.
4. Add Python Test Node.
5. Input → Python → Preview.
6. Execute.
7. Flow Map shows state.
8. DevTools shows execution.
9. Output arrives.
10. Cancel works.
11. Force Python crash.
12. TL survives.
13. Worker recovery visible.
14. Existing JS Flow works again.
```

Non migrare Knowledge prima di questo.

------------------------------------------------------------------------

# 67. Milestone 2

**Obiettivo:** dimostrare valore AI reale.

Implementare:

``` text
Embedding Generator
oppure
Semantic Reranker
```

Con:

-   stesso contratto TL;
-   benchmark;
-   quality comparison;
-   DevTools;
-   fallback.

------------------------------------------------------------------------

# 68. Milestone 3

**Obiettivo:** migliorare una debolezza Knowledge senza riscrivere
tutto.

Candidato:

``` text
Coreference Resolver
```

``` text
current extraction
   ↓
Python Coreference
   ↓
normalized data
   ↓
current Knowledge pipeline
```

Test globali, non hard-code su un singolo libro/documento.

------------------------------------------------------------------------

# 69. Milestone 4

**Obiettivo:** Hybrid Graph-RAG.

``` text
Graph
+ Vector Retrieval
+ Events
+ Evidence chunks
+ Reranking
+ Context compression
```

TL mantiene scope/provenance/policy.

------------------------------------------------------------------------

# 70. Milestone 5

**Obiettivo:** Python Node ecosystem production-ready.

Solo dopo:

-   SDK;
-   env manager;
-   permissions;
-   capability registry;
-   trusted developer workflow;
-   packaging;
-   documentazione;
-   Marketplace futuro.

------------------------------------------------------------------------

# 71. Cose che Codex NON deve fare

Non:

-   riscrivere TL in Python;
-   eliminare JS funzionante senza benchmark;
-   sostituire CMSwift;
-   rifare Flow Map;
-   mettere business logic in Electron Main;
-   dare Node access al renderer;
-   dare DB unrestricted a Python;
-   creare processo Python per ogni evento;
-   installare tutto PyTorch/ML per default;
-   cambiare Node ID/ports senza motivo;
-   rompere flow salvati;
-   perdere dati;
-   duplicare runtime esistenti;
-   introdurre Tauri/Rust;
-   fare fork Chromium;
-   trasformare questa migrazione in un mega-refactor unico.

------------------------------------------------------------------------

# 72. Priorità

Ordine:

1.  nessuna perdita dati;
2.  compatibilità;
3.  contratti stabili;
4.  isolamento processi;
5.  observability;
6.  migrazione progressiva;
7.  rollback;
8.  packaging;
9.  developer experience;
10. performance optimization.

------------------------------------------------------------------------

# 73. Aggiornamento documentazione

Dopo ogni fase verificare gli aggiornamenti richiesti da `AI.md`, in
particolare:

``` text
docs/ai/current-focus.md
docs/ai/project-state.md
docs/ai/architecture.md
docs/ai/file-map.md
docs/ai/runtime/contract.md
docs/ai/task-registry.md
docs/ai/decisions.md
```

Non ricreare grandi markdown monolitici di memoria progetto.

Questa guida non sostituisce la documentazione canonica `docs/ai/*`.

------------------------------------------------------------------------

# 74. Report Codex per ogni fase

Usare:

``` text
PHASE:
STATUS:

FILES CHANGED:
- ...

CONTRACTS CHANGED:
- ...

MIGRATIONS:
- ...

TESTS:
- ...

BACKWARD COMPATIBILITY:
- ...

PERFORMANCE:
- ...

KNOWN ISSUES:
- ...

ROLLBACK:
- ...

NEXT SAFE STEP:
- ...
```

Non dichiarare completata una fase con test critici falliti.

------------------------------------------------------------------------

# 75. Definition of Done --- Electron Beta

-   Electron start affidabile;
-   UI attuale funzionante;
-   Flow Map;
-   Flow Chat;
-   Runtime DevTools;
-   JS Nodes;
-   dati preservati;
-   bridge sicuro;
-   crash senza corruzione;
-   packaging sulle piattaforme beta;
-   dev workflow pratico.

------------------------------------------------------------------------

# 76. Definition of Done --- Python Runtime v1

-   Python gestito parte automaticamente;
-   niente setup Python manuale per utente;
-   protocollo versionato;
-   Runtime Manager lo rileva;
-   Node Python nel normale Flow;
-   progress/log/error visibili;
-   cancel;
-   timeout;
-   crash isolation;
-   recovery;
-   JS non influenzato;
-   feature flag/fallback;
-   almeno una capacità AI reale;
-   packaging corretto.

------------------------------------------------------------------------

# 77. Definition of Done --- Knowledge/RAG Python

-   dati vecchi leggibili;
-   contratti compatibili;
-   miglioramento misurato;
-   evidence/provenance conservata;
-   persistence sotto policy TL;
-   fallback dove richiesto;
-   DevTools spiega il percorso;
-   regression globali;
-   nessun hard-code su documento specifico.

------------------------------------------------------------------------

# 78. Visione finale

``` text
User Objective
      ↓
AI Orchestrator
      ↓
Capability selection
      ↓
┌──────────────────────────────────────┐
│ Trackers Lens Multi-Runtime          │
│                                      │
│ JS Node        Python Node           │
│ API Node       Local Model           │
│ RAG Node       Graph Node            │
│ Science Tool   External Tool         │
└──────────────────┬───────────────────┘
                   ↓
             Shared TL Runtime
                   ↓
       Memory + Knowledge + Events
                   ↓
            Observable Flow
                   ↓
                Result
```

Utente e agente devono ragionare in termini di **capacità**, non
linguaggi.

------------------------------------------------------------------------

# 79. Regola architetturale finale

> **Trackers Lens non deve diventare "un'app Python" e non deve
> diventare "Electron". Trackers Lens rimane Trackers Lens. Electron è
> la shell desktop; Node.js rimane il control plane e il cuore
> dell'orchestrazione; Python diventa un runtime cognitivo, AI, data e
> scientifico gestito; i componenti collaborano attraverso contratti TL
> stabili.**

Il lavoro esistente va protetto.

L'adozione Python deve essere:

``` text
progressiva
misurabile
reversibile
osservabile
backward-compatible
```

------------------------------------------------------------------------

# 80. Primo task che Codex deve eseguire

**Non implementare tutta questa guida in un'unica sessione.**

Inizia esclusivamente da **Phase 0 --- Architecture & Migration
Assessment**.

Codex deve:

1.  seguire il read order di `AI.md`;
2.  ispezionare il repository reale;
3.  mappare entry point;
4.  mappare runtime;
5.  mappare Node contracts;
6.  mappare Bus/channels;
7.  mappare storage;
8.  identificare dati da preservare;
9.  identificare dipendenze browser-only;
10. identificare cosa può essere riutilizzato direttamente in Electron;
11. trovare il punto corretto per Runtime Manager;
12. trovare il punto corretto per un futuro Python worker;
13. inventariare test;
14. identificare regression test mancanti;
15. proporre il piano concreto di Phase 1;
16. proporre rollback.

Restituisci il piano per revisione prima di fare modifiche
architetturali estese.

**Durante Phase 0 non riscrivere Memory, Knowledge Graph o RAG.**
