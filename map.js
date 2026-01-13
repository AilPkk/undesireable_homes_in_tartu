//This map will rank houses by "undesirability" and show on-hover and on-click tooltips with basic data.

// Throttle function to limit hover event execution rate
// NOTE: My laptop is a total toaster. Performance limiters are a must, however, I cannot feasibly verify if they work or not..
function throttle(fn, limit) {
  let lastCall = 0;
  return function(...args) {
    const now = new Date().getTime();
    if (now - lastCall >= limit) {
      lastCall = now;
      fn(...args);
    }
  };
}

import { busStopSymbol, shelterSymbol, pharmSymbol } from "./symbols.js";

require([
	"esri/Map",
	"esri/views/MapView",
	"esri/layers/WMSLayer",
	"esri/layers/GeoJSONLayer",
	"esri/layers/FeatureLayer",
	"esri/geometry/geometryEngine",
	"esri/geometry/Polyline"
], function(Map, MapView, WMSLayer, GeoJSONLayer, FeatureLayer, geometryEngine, Polyline) {

	// Initialize the map
	var map = new Map({
		basemap: "hybrid"
	});

	// Initialize the view, center it to desired region
	var view = new MapView({
		container: "mapContainer",
		map: map,
		center: [26.731, 58.378], // Tartu
		zoom: 16 // High enough to start calculations
	});

	// Define layers
	const noiseGeojsonLayer = new GeoJSONLayer({
		url: "data/noise.geojson",
		spatialReference: { wkid: 3857 }, // enforce CRS to ensure proper distance calculation
		renderer: {
            type: "simple",
            symbol: {
                type: "simple-fill",
                color: [0, 0, 0, 0],
                outline: null 
			}
        }
	});

	const buildingsGeojsonLayer = new GeoJSONLayer({
		url: "data/buildings.geojson",
		outFields: ["*"],
		spatialReference: { wkid: 3857 },
		renderer: {
			type: "simple",
			symbol: {
				type: "simple-fill",
				color: [0, 0, 0, 0],
				outline: {
					color: "black"
				} 
			}
        }
	});

	const busGeojsonLayer = new GeoJSONLayer({
		url: "data/bus.geojson",
		spatialReference: { wkid: 3857 },
		renderer: {
			type: "simple",
			symbol: busStopSymbol
		}
	});

	const pharmacyGeojsonLayer = new GeoJSONLayer({
		url: "data/pharmacy.geojson",
		spatialReference: { wkid: 3857 },
		renderer: {
			type: "simple",
			symbol: pharmSymbol
		}
	});

	const shelterGeojsonLayer = new GeoJSONLayer({
		url: "data/shelter.geojson",
		spatialReference: { wkid: 3857 },
		renderer: {
			type: "simple",
			symbol: shelterSymbol
		}
	});

	// Add the layers to the map
	// map.add(noiseGeojsonLayer); // No need to display
	map.add(buildingsGeojsonLayer);
	map.add(busGeojsonLayer);
	map.add(shelterGeojsonLayer);
	map.add(pharmacyGeojsonLayer);

	// Hover tooltip setup
	const tooltip = document.getElementById("tooltip");
	let lastHoveredFeature = null; // Cache for last hovered feature

	// Throttled hover event
	view.on("pointer-move", throttle(function(event) {
		view.hitTest(event).then(function(hoverResponse) {
			const hoverResults = hoverResponse.results;

			if (hoverResults.length > 0 && hoverResults[0].graphic.layer === buildingsGeojsonLayer) {
				const hoverGraphic = hoverResults[0].graphic;

                // If hits new valid object, generates new data for tooltip
				if (lastHoveredFeature !== hoverGraphic) {
					lastHoveredFeature = hoverGraphic;
	
				const value = hoverGraphic.attributes["lahiaadress"];

	            // Replaces tooltip location and contents
				if (value) {
					tooltip.style.left = event.x + "px";
					tooltip.style.top = event.y + "px";
					tooltip.style.visibility = "visible";
					tooltip.innerHTML = `${value}`;
				} else {
					tooltip.style.visibility = "hidden";
				}}
			} else {
				tooltip.style.visibility = "hidden";
				lastHoveredFeature = null; // Reset when no feature is hovered
			}
		});
	}, 500)); // Timer for throttle

	// NOTE: I spent nearly four hours debugging this to find out about selective automatic transformations

	// Function to calculate the shortest length to nearest point
	function calculateShortestGeodesicLength(polygonGeometry, pointLayer) {
        let shortestDistance = 1500;  // Start with upper limit of 1500 meters
        let nearestPoint = null;

        const polygonCentroid = polygonGeometry.centroid;
        const polygonX = polygonCentroid.x;
        const polygonY = polygonCentroid.y;

        // Query all features in the point layer
        return pointLayer.queryFeatures().then(function(pointFeatureSet) {
            pointFeatureSet.features.forEach(function(pointFeature) {
                const pointGeometry = pointFeature.geometry;

                // Skip undefined or empty geometries
                if (!pointGeometry) return;

                const pointX = pointGeometry.x;
                const pointY = pointGeometry.y;

                // Check if point is in the vicinity of the centroid
                if (Math.abs(pointX - polygonX) < 1500 && Math.abs(pointY - polygonY) < 1500) {

                    const distanceBetween = geometryEngine.distance(polygonCentroid, pointGeometry, "meters");

                    // Track the shortest length and nearest point
                    if (distanceBetween < shortestDistance) {
                        shortestDistance = distanceBetween;
                        nearestPoint = pointGeometry; // Useful in the future
                    }
                }
            });

            return { nearestPoint, shortestDistance };
        });
    }

	// Click event listener for polygons to find nearest point
	view.on("click", function(event) {
		view.hitTest(event).then(function(clickResponse) {
			const clickResults = clickResponse.results;

			// Check if a polygon was clicked
			if (clickResults.length > 0 && clickResults[0].graphic.layer === buildingsGeojsonLayer) {
				const polygonGraphic = clickResults[0].graphic;
				const polygonGeometry = polygonGraphic.geometry;

				let resultsText = `<strong>Address:</strong> ${polygonGraphic.attributes.lahiaadress}<br><strong>Nearest objects:</strong><br>`;

				// Calculate shortest length to nearest point for each point layer
				const pointLayersForNearest = [
					{ layer: busGeojsonLayer, label: "Bus stop: "},
					{ layer: shelterGeojsonLayer, label: "Shelter: "},
					{ layer: pharmacyGeojsonLayer, label: "Pharmacy: "}
				];
	
				// Create an array of promises for each layer
				const distancePromises = pointLayersForNearest.map(pointLayerObj =>
					calculateShortestGeodesicLength(polygonGeometry, pointLayerObj.layer)
						.then(result => ({ ...result, label: pointLayerObj.label }))
				);
	
				// Shortest dist calc is asynchronous by nature, we need to wait until all promises are resolved
				Promise.all(distancePromises).then(resultsArray => {
					resultsArray.forEach(result => {
						const { nearestPoint, shortestDistance, label } = result;
	
						if (nearestPoint) {
						resultsText += `${label} ${shortestDistance.toFixed(0)} meters<br>`;
						}
					});
	
					// Update the side panel after all results are processed
					document.getElementById("sidePanel").innerHTML = resultsText;
				});
			}
		});
	});

	// Setup of the new FeatureLayer to display heatmap
	const fields = [
		{ name: "OBJECTID", type: "oid" },
		{ name: "undesirability", type: "double" }
	];

	// Create a new FeatureLayer
	const calculatedPolygonsLayer = new FeatureLayer({
		source: [],
		fields: fields,
		objectIdField: "OBJECTID",
		geometryType: "polygon",
		spatialReference: { wkid: 3857 },
		title: "Calculated Polygons with Distances",
		renderer: {
			type: "simple",
			symbol: {
				type: "simple-fill",
				color: "white",
				outline: null 
			},
			visualVariables: [{
				type: "color",
				field: "undesirability",
				stops: [ // Sets color scale
					{ value: 0, color: "#00ff00" },
					{ value: 2000, color: "#ffff00" },
					{ value: 4000, color: "#ff0000" }
				]
			}]
		}
	});

	// Add the new layer to the map
	map.add(calculatedPolygonsLayer);

	// Makes buildings layer clickable
	map.reorder(buildingsGeojsonLayer, map.layers.length - 1);

	// Abortcontroller to stop unnecessary calculations
	let abortController = new AbortController();
	
	function calculateAndDisplayHeatmap() {
		if (view.zoom < 16) { // Limit calculation to higher zoom levels
			console.log("Zoom level is below 16; skipping calculations.");
			return;
		}

		// Check if the previous calculation can be aborted
		abortController.abort();
		abortController = new AbortController();

		calculatedPolygonsLayer.clear(); // Caching didn't work too well, go for manual clearing instead

		// Query for polygons within the current view extent
		buildingsGeojsonLayer.queryFeatures({
			geometry: view.extent,
			spatialRelationship: "intersects",
			returnGeometry: true,
			outFields: ["etak_id"],
			}, { signal: abortController.signal }).then(results => {
				if (abortController.signal.aborted) {
					return; // Exit if the calculation was aborted
				}
		
				const polygons = results.features;

				polygons.forEach(polygon => {
					polygon.geometry.spatialReference = { wkid: 3857 }; // Set spatial reference to Web Mercator
				});
		
				// Prepare promises to calculate distance sums for each uncached polygon
				const distanceSumPromises = polygons.map(polygon => {
					const polygonGeometry = polygon.geometry;
		
					// Verify that we have a valid geometry before proceeding and skip polygons with no geometry
					if (!polygonGeometry) {
						console.warn("Polygon with OBJECTID " + polygon.attributes.ID + " has no geometry.");
						return Promise.resolve(null);
					}
		
					const pointLayersForNearest = [busGeojsonLayer, shelterGeojsonLayer, pharmacyGeojsonLayer];
		
					// Calculate shortest length for each point layer
					const distancePromises = pointLayersForNearest.map(pointLayer =>
						calculateShortestGeodesicLength(polygonGeometry, pointLayer)
					);
		
					return Promise.all(distancePromises).then(resultsArray => {
						// Sum distances for each layer and store in cache
						const totalDistance = resultsArray.reduce((sum, result) => {
							return sum + (result?.shortestDistance || 0);
						}, 0);
		
						polygon.attributes.undesirability = totalDistance;
		
						return polygon;
					});
				});
		
			// Once all promises are resolved, check for intersections with otherPolygonLayer
			Promise.all(distanceSumPromises).then(updatedPolygons => {
				// Query features from noise pollution layer to get "valueField"
				return noiseGeojsonLayer.queryFeatures({
					geometry: view.extent,
					spatialRelationship: "intersects",
					returnGeometry: true,
					outFields: ["MYRAKLASS"]
				}).then(noiseResults => {
					const noisePolygons = noiseResults.features;

					updatedPolygons.forEach(polygon => {
						const polygonGeometry = polygon.geometry;
			
						noisePolygons.forEach(noisePolygon => {
							const noiseGeometry = noisePolygon.geometry;
							const valueFieldStr = noisePolygon.attributes.MYRAKLASS;
							const valueInt = parseInt(valueFieldStr, 10);
				
							if (!isNaN(valueInt) && geometryEngine.intersects(polygonGeometry, noiseGeometry)) {
								polygon.attributes.undesirability += valueInt * 10;
							}
						});
					});
			
					// applyEdits adds updated polygons to the calculatedPolygonsLayer
					calculatedPolygonsLayer.applyEdits({
						addFeatures: updatedPolygons
					}).then(() => {
						console.log("Polygons added successfully to calculatedPolygonsLayer.");
					}).catch(error => {
						console.error("Error adding polygons with applyEdits:", error);
					});
				});
			});
		}).catch(error => console.error("Error querying features:", error));
	}

	// Trigger function when view extent changes
	view.watch("extent", calculateAndDisplayHeatmap);
});
