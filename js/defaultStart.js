const utility = new Utility();
const db = new SQLiteRepository();

tlConfig.keyPage = cms.GET.key ?? utility.address();
const topBar = new TopBar({ db });
const dashboardMenu = new DashboardMenu({ db });
const mapPage = new MapPage({ db });
