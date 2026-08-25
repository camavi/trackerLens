class DatabaseIndexedDB {
  db;
  DB_NAME = "TrackersLens";
  DB_WIDGETS = 'tl_widgets';

  constructor(config = {}) {
    this.DB_NAME = config.dbName || this.DB_NAME;
    this.startTables = Array.isArray(config.startTables) ? config.startTables : [];
    this.ready = this.mount().catch((error) => {
      console.error("Errore inizializzazione IndexedDB:", error);
      throw error;
    });
  }

  desktopPersistence() {
    return window.trackers?.desktop?.persistence || null;
  }

  async usesDesktopSqlite() {
    if (this.desktopSqliteMode !== undefined) return this.desktopSqliteMode;
    const persistence = this.desktopPersistence();
    if (!persistence?.getStatus) return (this.desktopSqliteMode = false);
    try {
      this.desktopSqliteMode = (await persistence.getStatus())?.mode === "desktop-sqlite";
    } catch (_) {
      this.desktopSqliteMode = false;
    }
    return this.desktopSqliteMode;
  }

  desktopDbFacade() {
    return { objectStoreNames: { contains: () => true }, version: 1, close() {} };
  }

  async mount() {
    if (await this.usesDesktopSqlite()) return (this.db = this.desktopDbFacade());
    const openedDb = await this.openDatabase();
    const missingTables = this.startTables.filter((table) => !openedDb.objectStoreNames.contains(table.name));

    if (!missingTables.length) return openedDb;

    const nextVersion = openedDb.version + 1;
    openedDb.close();
    if (this.db === openedDb) this.db = null;

    this.db = await this.upgradeDatabase(nextVersion, missingTables);
    return this.db;
  }

  bindVersionChange(db) {
    db.onversionchange = () => {
      db.close();
      if (this.db === db) this.db = null;
      console.warn("IndexedDB chiuso per consentire aggiornamento da un'altra scheda.");
    };
    return db;
  }

  async getVersion() {
    if (await this.usesDesktopSqlite()) return 1;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME);
      let blockedTimer = null;
      const clearBlockedTimer = () => {
        if (blockedTimer) clearTimeout(blockedTimer);
      };

      request.onsuccess = (event) => {
        clearBlockedTimer();
        const db = event.target.result;
        const version = db.version;
        db.close(); // Chiudiamo il database dopo aver ottenuto la versione
        resolve(version);
      };

      request.onerror = (event) => {
        clearBlockedTimer();
        console.error("Errore nell'apertura del database:", event.target.errorCode);
        reject(event.target.errorCode);
      };

      request.onblocked = () => {
        console.warn("Apertura IndexedDB in attesa: un'altra scheda tiene aperta una vecchia connessione.");
        blockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
      };
    });
  }

  async openDatabase() {
    if (await this.usesDesktopSqlite()) return (this.db = this.desktopDbFacade());
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME);
      let blockedTimer = null;
      const clearBlockedTimer = () => {
        if (blockedTimer) clearTimeout(blockedTimer);
      };

      request.onupgradeneeded = (event) => {
        this.db = this.bindVersionChange(event.target.result);
        console.log("Database creato o aggiornato.");
      };

      request.onsuccess = (event) => {
        clearBlockedTimer();
        this.db = this.bindVersionChange(event.target.result);
        console.log("Database aperto con successo");
        resolve(this.db);
      };

      request.onerror = (event) => {
        clearBlockedTimer();
        console.error("Errore nell'apertura del database:", event);
        reject(event.target.errorCode);
      };

      request.onblocked = () => {
        console.warn("Apertura IndexedDB in attesa: un'altra scheda tiene aperta una vecchia connessione.");
        blockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
      };
    });
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async upgradeDatabase(version, tables) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, version);
      let blockedTimer = null;
      const clearBlockedTimer = () => {
        if (blockedTimer) clearTimeout(blockedTimer);
      };

      request.onupgradeneeded = async (event) => {
        const db = event.target.result;
        tables.forEach((table) => {
          if (db.objectStoreNames.contains(table.name)) return;

          const objectStore = db.createObjectStore(table.name, { keyPath: "id" });
          console.log(`Object store "${table.name}" inizio a creazione`);
          (table.columns || []).forEach((column) => {
            objectStore.createIndex(
              column.name,
              column?.keyPath ?? column.name,
              column?.options ?? { unique: false }
            );
          });
          console.log(`Object store "${table.name}" creato con successo`);
        });
      };

      request.onsuccess = (event) => {
        clearBlockedTimer();
        const upgradedDb = this.bindVersionChange(event.target.result);
        console.log("Database aggiornato con gli object store mancanti.");
        resolve(upgradedDb);
      };

      request.onerror = (event) => {
        clearBlockedTimer();
        console.error("Errore nella creazione dell'object store:", event.target.error);
        reject(event.target.error);
      };

      request.onblocked = () => {
        console.warn("Upgrade IndexedDB in attesa: un'altra scheda tiene aperta una vecchia connessione.");
        blockedTimer = setTimeout(() => reject(new Error("IndexedDB bloccato da un'altra scheda.")), 8000);
      };
    });
  }

  async createTables(table, columns = []) {
    if (await this.usesDesktopSqlite()) return;
    if (!this.db) await this.openDatabase();
    if (this.db.objectStoreNames.contains(table)) {
      console.log(`Object store "${table}" esiste già`);
      return;
    }

    const nextVersion = this.db.version + 1;
    this.db.close();
    this.db = null;
    this.db = await this.upgradeDatabase(nextVersion, [{ name: table, columns }]);
  }

  async addData(table, data) {
    if (await this.usesDesktopSqlite()) {
      await this.desktopPersistence().writeDevelopmentRecords({ storeName: table, records: [data] });
      return data;
    }
    return new Promise(async (resolve, reject) => {
      const objectStore = await this.objectStore(table, "readwrite");
      const request = objectStore.add(data);

      request.onsuccess = () => {
        console.log("Dato aggiunto con successo:", data);
        resolve(data); // Risolvi la Promise con il dato aggiunto
      };

      request.onerror = (event) => {
        console.error("Errore nell'aggiunta del dato:", event.target.errorCode);
        reject(event.target.errorCode); // Rifiuta la Promise in caso di errore
      };
    });
  }
  async search(table, column, value) {
    if (await this.usesDesktopSqlite()) {
      return (await this.desktopPersistence().readDevelopmentRecords({ storeName: table }))
        .filter((record) => record?.[column] === value);
    }
    return new Promise(async (resolve, reject) => {
      const objectStore = await this.objectStore(table, "readonly");
      const index = objectStore.index(column);
      const request = index.getAll(value);

      request.onsuccess = (event) => {
        console.log("Risultati trovati:", event.target.result);
        resolve(event.target.result); // Risolve con i risultati trovati
      };

      request.onerror = (event) => {
        console.error("Errore nella ricerca:", event.target.errorCode);
        reject([]); // Rifiuta con un array vuoto in caso di errore
      };
    });
  }
  async getAllData(table) {
    if (await this.usesDesktopSqlite()) return this.desktopPersistence().readDevelopmentRecords({ storeName: table });
    return new Promise(async (resolve, reject) => {
      const objectStore = await this.objectStore(table, "readonly");
      const request = objectStore.getAll();

      request.onsuccess = (event) => {
        console.log("Risultati trovati:", event.target.result);
        resolve(Array.from(event.target.result)); // Risolve con i risultati trovati
      };

      request.onerror = (event) => {
        console.error("Errore nella ricerca:", event.target.errorCode);
        reject([]); // Rifiuta con un array vuoto in caso di errore
      };
    });
  }


  async getData(table, id) {
    if (await this.usesDesktopSqlite()) return (await this.desktopPersistence().readDevelopmentRecords({ storeName: table })).find((record) => record.id === id) || null;
    return new Promise(async (resolve, reject) => {
      const objectStore = await this.objectStore(table, "readonly");
      const request = objectStore.get(id);

      request.onsuccess = (event) => {
        console.log("Dato recuperato:", event.target.result);
        resolve(event.target.result); // Risolvi la Promise con il dato recuperato
      };

      request.onerror = (event) => {
        console.error("Errore nel recupero del dato:", event.target.errorCode);
        reject(event.target.errorCode); // Rifiuta la Promise in caso di errore
      };
    });
  }

  async updateData(table, data) {
    if (await this.usesDesktopSqlite()) {
      await this.desktopPersistence().writeDevelopmentRecords({ storeName: table, records: [data] });
      return data;
    }
    return new Promise(async (resolve, reject) => {
      const objectStore = await this.objectStore(table, "readwrite");
      const request = objectStore.put(data);

      request.onsuccess = () => {
        console.log("Dato aggiornato con successo:", data);
        resolve(data); // Risolve la Promise con il dato aggiornato
      };

      request.onerror = (event) => {
        console.error("Errore nell'aggiornamento del dato:", event.target.errorCode);
        reject(event.target.errorCode); // Rifiuta la Promise in caso di errore
      };
    });
  }

  async deleteData(table, id) {
    if (await this.usesDesktopSqlite()) {
      await this.desktopPersistence().deleteDevelopmentRecords({ storeName: table, ids: [id] });
      return id;
    }
    return new Promise(async (resolve, reject) => {
      const objectStore = await this.objectStore(table, "readwrite");
      const request = objectStore.delete(id);

      request.onsuccess = () => {
        console.log("Dato cancellato con successo, id:", id);
        resolve(id); // Risolve la Promise con l'id cancellato
      };

      request.onerror = (event) => {
        console.error("Errore nella cancellazione del dato:", event.target.errorCode);
        reject(event.target.errorCode); // Rifiuta la Promise in caso di errore
      };
    });
  }
  async tableExists(tableName) {
    if (await this.usesDesktopSqlite()) return true;
    await this.ready;

    // Verifica se l'object store esiste
    return this.db?.objectStoreNames.contains(tableName) || false;
  }

  async objectStore(table, mode = "readwrite") {
    if (await this.usesDesktopSqlite()) throw new Error("SQLite desktop uses repository methods, not object stores.");
    await this.ready;

    // Assicurati che il database sia aperto
    if (!this.db) {
      await this.openDatabase(); // Se `openDatabase` è già asincrona
    }

    const transaction = this.db.transaction([table], mode);
    return transaction.objectStore(table);
  }
}
