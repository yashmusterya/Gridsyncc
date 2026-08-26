# planTrip()

> God node · 20 connections · `script.js`

**Community:** [Map, Route & Station Rendering](Map,_Route_&_Station_Rendering.md)

## Connections by Relation

### calls
- [initMap()](initMap.md) `EXTRACTED`
- [plotMarkers()](plotMarkers.md) `EXTRACTED`
- calculateBestRecommendation() `EXTRACTED`
- updateRecommendationDashboard() `EXTRACTED`
- renderRouteChargersList() `EXTRACTED`
- fetchLiveGridTelemetry() `EXTRACTED`
- showStatus() `EXTRACTED`
- fetchIndiaEnergyAtlasGridData() `EXTRACTED`
- updateVehiclePosition() `EXTRACTED`
- showToastNotification() `EXTRACTED`
- logAnalyticsEvent() - fire-and-forget POST to /api/analytics/event `EXTRACTED`
- filterOnRouteChargers() `EXTRACTED`
- window.addChargerStopover() `EXTRACTED`
- logAnalyticsEvent() `EXTRACTED`
- window.selectStationAsDestination() `EXTRACTED`

### contains
- script.js `EXTRACTED`

### indirect_call
- hideStatus() `INFERRED`

### shares_data_with
- activeRouteInfo `EXTRACTED`
- directionsService / directionsRenderer `EXTRACTED`
- lastDirectionsResponse (fixed: was an implicit global) `EXTRACTED`

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*