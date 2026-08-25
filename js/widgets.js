const utility = new Utility();
const db = new SQLiteRepository();

tlConfig.keyPage = cms.GET.key ?? utility.address();
const topBar = new TopBar({ db, mode: 'editWidget' });
const dashboardMenu = new DashboardMenu({ db });
const getWidgets = db.getAllData(tlConfig.TABLES.TL_WIDGETS);
