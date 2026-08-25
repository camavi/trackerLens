class SQLiteRepository {
  constructor() {
    this.ready = this.ensure();
  }

  async ensure() {
    const persistence = window.trackers?.desktop?.persistence;
    if (!persistence?.getStatus || !persistence.readDevelopmentRecords || !persistence.writeDevelopmentRecords || !persistence.deleteDevelopmentRecords) throw new Error("SQLite bridge non disponibile.");
    if ((await persistence.getStatus())?.mode !== "desktop-sqlite") throw new Error("SQLite desktop non disponibile.");
    return persistence;
  }

  async getAllData(table) { return (await this.ready).readDevelopmentRecords({ storeName: table }); }
  async getData(table, id) { return (await this.getAllData(table)).find((record) => record.id === id) || null; }
  async addData(table, data) { await (await this.ready).writeDevelopmentRecords({ storeName: table, records: [data] }); return data; }
  async updateData(table, data) { return this.addData(table, data); }
  async deleteData(table, id) { await (await this.ready).deleteDevelopmentRecords({ storeName: table, ids: [id] }); return id; }
  async search(table, column, value) { return (await this.getAllData(table)).filter((record) => record?.[column] === value); }
  async tableExists() { return true; }
  async createTables() {}
}
