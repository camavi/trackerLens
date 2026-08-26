const icon = (name, size = "md") => _.Icon({ name, size });
const btn = (props, ...children) => _.Btn({ type: "button", ...props }, ...children);
const dot = (tone = "online") => _.span({ class: `tl-python-runtime-dot is-${tone}`, "aria-hidden": "true" });
const formatBytes = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const stateLabel = (state) => ({ active: "Attivo", installed: "Installato", unavailable: "Non disponibile", missing: "Non installato" })[state] || "Sconosciuto";
const stateTone = (state) => state === "active" || state === "installed" ? "online" : "warn";

const state = {
  loading: true,
  catalog: null,
  error: "",
  notice: "",
  updatedAt: null,
  installProgress: null,
  requestedPackId: new URLSearchParams(window.location.search).get("pack") || "",
  openInstallOnLoad: new URLSearchParams(window.location.search).get("install") === "1",
};

const renderBrand = () => window.TrackerLensSidebar.renderBrand({ className: "tl-python-runtime-brand" });
const renderSidebar = () => window.TrackerLensSidebar.render({ activeId: "python-runtime" });
const statusPill = (value) => _.span({ class: `tl-python-runtime-status is-${stateTone(value)}` }, dot(stateTone(value)), stateLabel(value));

const renderLoading = () => _.section(
  { class: "tl-python-runtime-empty" },
  icon("progress_activity", "lg"),
  _.strong("Lettura dell’inventario locale…"),
  _.span("Trackers Lens sta leggendo solo i pack e i modelli che gestisce.")
);

const renderUnavailable = () => _.section(
  { class: "tl-python-runtime-empty is-error" },
  icon("memory", "lg"),
  _.strong("Runtime Python non disponibile"),
  _.span(state.error || "Apri questa pagina dall’app desktop Trackers Lens."),
  _.small("Nessun percorso locale, handle filesystem o comando shell è esposto a questa pagina.")
);

const renderCatalog = () => {
  const catalog = state.catalog;
  if (!catalog) return state.loading ? renderLoading() : renderUnavailable();
  const installedModels = catalog.models.filter((model) => model.state === "installed");
  const totalSize = installedModels.reduce((total, model) => total + (Number(model.sizeBytes) || 0), 0);
  return _.div(
    { class: "tl-python-runtime-content" },
    _.section(
      { class: "tl-python-runtime-hero" },
      _.div(
        _.span({ class: "tl-python-runtime-orb" }, icon("memory", "lg")),
        _.div(_.h1("Runtime Python e Modelli"), _.p("Inventario trasparente degli ambienti, pack e modelli locali gestiti da Trackers Lens."))
      ),
      btn({ class: "st-btn-primary", onclick: refreshCatalog }, icon("refresh", "sm"), "Aggiorna")
    ),
    state.installProgress ? _.section(
      { class: `tl-python-runtime-progress is-${state.installProgress.phase || "active"}` },
      _.div(_.strong("Installazione Python"), _.span(state.installProgress.message || "Operazione in corso")),
      _.div({ class: "tl-python-runtime-progress-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Number(state.installProgress.progress || 0) }, _.i({ style: `--tl-python-install-progress:${Math.max(0, Math.min(100, Number(state.installProgress.progress || 0)))}%` })),
      _.small(state.installProgress.phase === "downloading-model" ? "Download modello in corso: il provider non espone una percentuale in byte." : `${Number(state.installProgress.progress || 0)}% · ${state.installProgress.phase || "preparing"}`)
    ) : null,
    _.section(
      { class: "tl-python-runtime-summary", "aria-label": "Riepilogo runtime Python" },
      _.div(_.small("Pack gestiti"), _.strong(String(catalog.packs.length)), _.span(`${catalog.packs.filter((pack) => pack.state === "active").length} attivi`)),
      _.div(_.small("Modelli locali"), _.strong(String(installedModels.length)), _.span(`${catalog.models.length} registrati`)),
      _.div(_.small("Spazio modelli"), _.strong(formatBytes(totalSize)), _.span("calcolato localmente"))
    ),
    _.section(
      { class: "tl-python-runtime-section" },
      _.div({ class: "tl-python-runtime-section-heading" }, icon("terminal", "sm"), _.h2("Ambienti")),
      _.div(
        { class: "tl-python-runtime-list" },
        ...catalog.environments.map((environment) => _.article(
          { class: "tl-python-runtime-row" },
          _.span({ class: "tl-python-runtime-row-icon" }, icon("terminal", "sm")),
          _.div(_.strong(environment.id), _.span(environment.interpreter), _.small(`Runtime: ${environment.runtime?.status || "stopped"}`)),
          _.span({ class: `tl-python-runtime-status is-${environment.interpreterInstalled ? "online" : "warn"}` }, dot(environment.interpreterInstalled ? "online" : "warn"), environment.interpreterInstalled ? (environment.enabled ? "Abilitato" : "Installato") : "Mancante")
        ))
      )
    ),
    _.section(
      { class: "tl-python-runtime-section" },
      _.div({ class: "tl-python-runtime-section-heading" }, icon("deployed_code", "sm"), _.h2("Pack gestiti")),
      _.div(
        { class: "tl-python-runtime-list" },
        ...catalog.packs.map((pack) => _.article(
          { class: "tl-python-runtime-pack" },
          _.div(_.strong(pack.id), _.span(`v${pack.version} · ${pack.environmentId} · ${pack.trustLevel}`)),
          _.div({ class: "tl-python-runtime-pack-actions" }, statusPill(pack.state), pack.state === "unavailable" ? btn({ class: "tl-python-runtime-install", onclick: () => requestPackInstallation(pack) }, icon("download", "sm"), "Installa") : null),
          _.p(`Python ${pack.python || "N/D"} · ${pack.requirements.map((requirement) => `${requirement.name} ${requirement.version}`).join(", ") || "nessuna dipendenza dichiarata"}`),
          pack.capabilities.length ? _.code(pack.capabilities.join(" · ")) : null
        ))
      )
    ),
    _.section(
      { class: "tl-python-runtime-section" },
      _.div({ class: "tl-python-runtime-section-heading" }, icon("psychology", "sm"), _.h2("Modelli")),
      _.div(
        { class: "tl-python-runtime-list" },
        ...(catalog.models.length ? catalog.models.map((model) => _.article(
          { class: "tl-python-runtime-model" },
          _.div(
            { class: "tl-python-runtime-model-main" },
            _.span({ class: "tl-python-runtime-row-icon" }, icon("psychology", "sm")),
            _.div(_.strong(model.displayName), _.code(model.id), _.small(`revision ${model.revision || "N/D"} · ${model.dimensions || "N/D"} dimensioni · ${model.languages || "N/D"} lingue · ${model.license}`))
          ),
          _.div(
            { class: "tl-python-runtime-model-actions" },
            statusPill(model.state),
            _.strong(formatBytes(model.sizeBytes)),
            model.state === "missing" ? btn({
              class: "tl-python-runtime-install",
              onclick: () => {
                const pack = catalog.packs.find((item) => model.packIds?.includes(item.id));
                if (pack) void requestPackInstallation(pack);
                else {
                  state.error = `Nessun pack gestito disponibile per ${model.displayName}`;
                  mount();
                }
              }
            }, icon("download", "sm"), "Installa") : null,
            model.state === "installed" ? btn({ class: "tl-python-runtime-delete", "aria-label": `Rimuovi ${model.displayName}`, onclick: () => requestModelRemoval(model) }, icon("delete", "sm")) : null
          )
        )) : [_.div({ class: "tl-python-runtime-empty-list" }, "Nessun modello Python registrato.")])
      ),
      _.p({ class: "tl-python-runtime-warning" }, "Rimuovere un modello arresta l’ambiente NLP interessato. La rimozione è definitiva e richiede conferma esplicita.")
    )
  );
};

const renderShell = () => _.div(
  { class: "tl-python-runtime-shell" },
  _.header(
    { class: "tl-python-runtime-topbar" },
    renderBrand(),
    _.div({ class: "tl-python-runtime-topbar-copy" }, _.strong("Runtime Python e Modelli"), _.span("Gestione locale, trasparente e controllata")),
    _.span({ class: `tl-python-runtime-live ${state.error ? "is-error" : ""}` }, dot(state.error ? "error" : "online"), state.error || state.notice || "Catalogo locale")
  ),
  _.div({ class: "tl-python-runtime-body" }, renderSidebar(), _.main({ class: "tl-python-runtime-main" }, renderCatalog()))
);

const mount = () => {
  const root = document.getElementById("tl-python-runtime-root");
  if (root) root.replaceChildren(renderShell());
};

const loadCatalog = async () => {
  const bridge = window.trackers?.runtime?.pythonRuntime;
  if (!bridge?.getCatalog) {
    state.loading = false;
    state.catalog = null;
    state.error = "Apri questa pagina dall’app desktop Trackers Lens.";
    return;
  }
  state.loading = true;
  state.error = "";
  try {
    state.catalog = await bridge.getCatalog();
    state.updatedAt = new Date();
  } catch (error) {
    state.catalog = null;
    state.error = error?.message || "Inventario Python non disponibile";
  } finally {
    state.loading = false;
  }
};

const refreshCatalog = async () => {
  await loadCatalog();
  state.notice = state.catalog ? "Inventario aggiornato" : "";
  mount();
};

const requestModelRemoval = (model) => {
  const dialog = _.Dialog({
    class: "tl-python-runtime-remove-dialog",
    panelClass: "tl-python-runtime-remove-panel",
    size: "md",
    title: "Rimuovere questo modello Python?",
    subtitle: model.displayName,
    icon: "delete_forever",
    closeButton: true,
    content: () => _.div(
      { class: "tl-python-runtime-remove-copy" },
      _.p("Il modello locale sarà eliminato definitivamente. TL fermerà prima il runtime NLP che lo sta usando."),
      _.div(_.span("Modello"), _.code(model.id)),
      _.div(_.span("Revisione"), _.strong(model.revision || "N/D")),
      _.div(_.span("Spazio liberato"), _.strong(formatBytes(model.sizeBytes)))
    ),
    actions: ({ close }) => _.Toolbar(
      { align: "end", gap: 8 },
      btn({ onclick: close }, "Annulla"),
      btn({ class: "is-danger", onclick: async () => {
        try {
          await window.trackers.runtime.pythonRuntime.removeModel({ modelId: model.id, confirmed: true });
          close();
          await loadCatalog();
          state.notice = `${model.displayName} rimosso`;
        } catch (error) {
          state.error = error?.message || "Impossibile rimuovere il modello Python";
        }
        mount();
      } }, icon("delete_forever", "sm"), "Rimuovi definitivamente")
    )
  });
  dialog.open();
};

const requestPackInstallation = async (pack) => {
  try {
    const plan = await window.trackers?.runtime?.pythonRuntime?.getInstallPlan?.({ packId: pack.id });
    if (!plan) throw new Error("Piano di installazione Python non disponibile");
    const dialog = _.Dialog({
      class: "tl-python-runtime-install-dialog",
      panelClass: "tl-python-runtime-install-panel",
      size: "lg",
      title: "Installare il pack Python?",
      subtitle: `${plan.pack.id} · v${plan.pack.version}`,
      icon: "download",
      closeButton: true,
      content: () => _.div(
        { class: "tl-python-runtime-install-copy" },
        _.p("TL installerà esclusivamente il lockfile dichiarato dal pack. Il Nodo non riceve accesso a pip, shell o filesystem."),
        _.div(_.span("Ambiente"), _.strong(`${plan.environment.id} · ${plan.environment.action === "create" ? "verrà creato" : "verrà riutilizzato"}`)),
        _.div(_.span("Lockfile"), _.code(plan.integrity.lockfile)),
        _.div(_.span("Dipendenze"), _.code(plan.requirements.map((item) => `${item.name} ${item.version}`).join(", "))),
        _.div(_.span("Modelli"), _.code(plan.models.map((model) => `${model.id}@${model.revision}`).join(", ") || "nessuno")),
        _.div(_.span("Rete"), _.strong(plan.network.required ? "Richiesta: pacchetti/modelli saranno scaricati" : "Non richiesta")),
        _.p({ class: "tl-python-runtime-install-warning" }, plan.integrity.hashesPresent ? "Il lockfile contiene hash di integrità." : "Le versioni sono bloccate; questo lockfile non contiene hash di integrità.")
      ),
      actions: ({ close }) => _.Toolbar(
        { align: "end", gap: 8 },
        btn({ onclick: close }, "Annulla"),
        btn({ class: "st-btn-primary", onclick: async () => {
          try {
            close();
            state.installProgress = { packId: pack.id, phase: "preparing", progress: 0, message: "Preparazione installazione" };
            mount();
            await window.trackers.runtime.pythonRuntime.installPack({ packId: pack.id, confirmed: true });
            await loadCatalog();
            state.notice = `${pack.id} installato e verificato`;
          } catch (error) {
            state.error = error?.message || "Installazione Python non riuscita";
          } finally {
            state.installProgress = null;
          }
          mount();
        } }, icon("download", "sm"), "Installa pack")
      )
    });
    dialog.open();
  } catch (error) {
    state.error = error?.message || "Piano di installazione Python non disponibile";
    mount();
  }
};

const boot = async () => {
  window.trackers?.runtime?.pythonRuntime?.onInstallProgress?.((progress) => {
    state.installProgress = progress;
    if (progress.phase === "error") state.error = progress.message || "Installazione Python non riuscita";
    mount();
  });
  mount();
  await loadCatalog();
  mount();
  if (state.openInstallOnLoad && state.requestedPackId) {
    state.openInstallOnLoad = false;
    const pack = state.catalog?.packs?.find((item) => item.id === state.requestedPackId);
    if (pack?.state === "unavailable") void requestPackInstallation(pack);
  }
};

if (window.CMSwift?.ready) CMSwift.ready(boot);
else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
