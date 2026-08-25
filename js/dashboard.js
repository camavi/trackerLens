const utility = new Utility();
const db = new SQLiteRepository();

tlConfig.keyPage = _?.GET?.key ?? utility.address();
const topBar = new TopBar({ db });
const dashboardMenu = new DashboardMenu({ db });
const mapPage = new MapPage({ db });

mapPage.moveWidget({
  posRow: 1,
  posCol: 5,
});
mapPage.moveWidget({
  posRow: 6,
  posCol: 3,
});
mapPage.moveWidget({
  posRow: 9,
  posCol: 3,
});
