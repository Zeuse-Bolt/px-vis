importScripts("../pxd3/d3.min.js");

var dataMapping = {},
    quadtrees = {},
    voronois = {};

function reply(data, time) {

  //var time2 = this.performance.now();
  var time2 = null;
  if(data) {
    postMessage({'data': data, 'timeIn': time, 'timeOut': time2});
  } else {
    postMessage({'timeIn': time, 'timeOut': time2});
  }
}

/**
 * Creates the d3 scales based on passed in type, range, and domain
 *
 * This method must be kept in sync with the types available to the rest of the framework...
 *
 * @method recreateD3Scale
 */
function recreateD3Scale(scaleObj) {

  var result;
  if(scaleObj.type === 'time') {
    result = d3.scaleUtc().nice().range(scaleObj.range).domain(scaleObj.domain);
  } else if(scaleObj.type === 'timeLocal') {
    result = d3.scaleTime().nice().range(scaleObj.range).domain(scaleObj.domain);
  } else if(scaleObj.type === 'linear') {
    result = d3.scaleLinear().nice().range(scaleObj.range).domain(scaleObj.domain);
  } else if(scaleObj.type === 'scaleBand') {
    result = d3.scaleBand().range(scaleObj.range).domain(scaleObj.domain).round(true).paddingInner(0.5);
  } else { //ordinal
    result = d3.scalePoint().range(scaleObj.range).domain(scaleObj.domain).padding(0.5);
  }
  return result;
}

function getMultiScale(visData) {
  var o = {},
      k,
      axis;
  for(var i = 0; i < visData.keys.length; i++) {
    k = visData.keys[i];
    axis = visData.completeSeriesConfig[k]['axis'] ? visData.completeSeriesConfig[k]['axis']['id'] : "default";

    if(!o[axis]) {
      o[axis] = recreateD3Scale(visData.y[axis]);
    }
  }

  return o;
}

function createDataStub() {
  return {
    "series" : [],
    "rawData" : [],
    "timeStamps" : [],
    "timeStampsTracker" : {}
  }
}

/**
 * Creates the quadtree data structure which we will use to search later
 *
 * @method createQuadtree
 */
function createQuadtree(data, time) {
  quadtrees[data.chartId] = data.data.searchType === 'closestPoint' ?
    createSingleQuadtree(data) :
    createSeriesQuadtree(data);

  reply(null, time);
}

function createSingleQuadtree(data) {
  var visData = data.data,
      chartData = dataMapping[data.chartId],
      xScale = recreateD3Scale(visData.x),
      yScale = getMultiScale(visData),
      flatData,
      quadtree = d3.quadtree()
        .extent(visData.extents)
        .x(function(d) { return xScale(d.x); })
        .y(function(d) { return yScale[d.axis](d.y); });

    for(var i = 0; i < chartData.length; i++) {
      flatData = flattenData(visData, chartData[i]);
      
      quadtree.addAll(flatData);
    }

    console.log(quadtree);

    return quadtree;
}

function flattenData(visData, d) {
  var arr = [];
  for(var i = 0; i < visData.keys.length; i++) {
    var o = {}, 
        k = visData.keys[i];

    o["data"] = d;
    o["key"] = k;
    o["x"] = d[visData.completeSeriesConfig[k]['x']];
    o["y"] = d[visData.completeSeriesConfig[k]['y']];
    o["axis"] = visData.completeSeriesConfig[k]['axis'] ? visData.completeSeriesConfig[k]['axis']['id'] : "default";

    arr.push(o);
  }

  return arr;
}

function createSeriesQuadtree(data) {
  var visData = data.data,
      chartData = dataMapping[data.chartId],
      k,
      xKey,
      yKey,
      axis,
      quadtree = {},
      // we can't pass d3 scales around so we need to recretate them
      xScale = recreateD3Scale(visData.x),
      yScale;

  for(var i = 0; i < visData.keys.length; i++) {
    k = visData.keys[i];

    //create an object and bind it to the x and y accessors so that the scales
    //won't be overriden by the next iteration of the loop
    var obj = buildQuadtreeHelperObj(visData, k, i);

    // if we are just doing closestPoint, then do not reset the quadtree
    quadtree[k] = d3.quadtree()
      .extent(visData.extents)
      .x(function(d) { return xScale(d[this.xKey]); }.bind(obj))
      .y(function(d) { return this.yScale(d[this.yKey]); }.bind(obj))
      .addAll(chartData);
  }

  return quadtree;
}

function buildQuadtreeHelperObj(visData, k, index) {
  var obj = {};

  obj.xKey = visData.completeSeriesConfig[k]['x'];
  obj.yKey = visData.completeSeriesConfig[k]['y'];
  axis = visData.completeSeriesConfig[k]['axis'] ? visData.completeSeriesConfig[k]['axis']['id'] : null;
  //TODO: check if same scale
  obj.yScale = recreateD3Scale(visData.y[axis]);
  obj.yScale.index = index;

  return obj;
}

/**
 * Updates the local data with new data
 *
 * @method updateData
 */
function updateData(eventData, time) {

  dataMapping[eventData.chartId] = eventData.data.chartData;
  reply(null, time);
}

/**
 * Returns the pixel space value for a datapoint
 *
 * @method _getPixelSpaceVal
 */
function _getPixelSpaceVal(d, chartScale, key, axis) {
  return axis ? chartScale[axis](d[key]) : chartScale(d[key]);
}

/**
 * Calcs and returns the tooltipData.series value
 *
 * @method calcValueQuadtree
 */
function calcValueQuadtree(d, x, y) {
  var o = {};

  o[x] = d[x];
  o[y] = d[y];

  return o;
}

/**
 * Calcs and returns the tooltipData.series.coord
 *
 * @method calcCoordQuadtree
 */
function calcCoordQuadtree(d, x, y, xScale, yScale) {
  var a = [];

  a[0] = xScale(d[x]);
  a[1] = yScale(d[y]);

  return a;
}

/**
 * Calcs and returns the tooltipData.series obj
 *
 * @method calcDataSeriesQuadtree
 */
function calcDataSeriesQuadtree(d, k, xScale, yScale, completeSeriesConfig) {
  var x = completeSeriesConfig[k]['x'],
      y = completeSeriesConfig[k]['y'];

  return {
    "coord": this.calcCoordQuadtree(d, x, y, xScale, yScale),
    "name": k,
    "value": this.calcValueQuadtree(d, x, y, xScale, yScale)
  }
}

/**
 * Calcs and returns the crosshair data objs
 *
 * @method addCrosshairDataQuadtree
 */
function addCrosshairDataQuadtree(dataObj, d, timeData) {
  // FIXME we can dedupe datasets with timeData this way. Need to make a way to do it for non-timedata datasets...
  if((timeData && !dataObj.timeStampsTracker[d[timeData]])) {
    dataObj.rawData.push(d);
    dataObj.timeStamps.push(d[timeData]);
    dataObj.timeStampsTracker[d[timeData]] = true;

    dataObj.rawData.push(d);
  } else if(!timeData) {
    dataObj.rawData.push(d);
  }

  return dataObj;
}

/**
 * Finds the closest Quadtree nodes to the mouse. Returns fully constructed tooltip/crosshair data obj
 *
 * @method returnClosestsQuadtreePoints
 */
function returnClosestsQuadtreePoints(eventData, time) {
  var visData = eventData.data,
      dataObj = createDataStub(),
      quadtreeData = quadtrees[eventData.chartId],
      xScale = recreateD3Scale(visData.x);

  dataObj = visData.searchType === 'closestPoint' ?
    searchQuadtreeSingle(visData, dataObj, quadtreeData, xScale) :
    searchQuadtreeSeries(visData, dataObj, quadtreeData, xScale);

  delete dataObj.timeStampsTracker;
  reply(dataObj, time);
}

function searchQuadtreeSingle(visData, dataObj, quadtreeData, xScale) {
  var result,
      k;

  result = quadtreeData.find(visData.mousePos[0], visData.mousePos[1]);

  for(var i = 0; i < visData.keys.length; i++) {
    k = visData.keys[i];

    dataObj = constructDataObj(result.data, dataObj, k, visData, xScale);
  }

  return dataObj;
}

function searchQuadtreeSeries(visData, dataObj, quadtreeData, xScale) {
  var result,
      k;

  for(var i = 0; i < visData.keys.length; i++) {
    k = visData.keys[i];

    result = quadtreeData[k].find(visData.mousePos[0], visData.mousePos[1]);

    dataObj = constructDataObj(result, dataObj, k, visData, xScale);
  }

  return dataObj;
}

function constructDataObj(result, dataObj, k, visData, xScale) {
  var yScale,
      axis;

  if(!result) {
    dataObj.series.push(emptySeries(k));

  } else {
    axis = visData.completeSeriesConfig[k]['axis'] ? visData.completeSeriesConfig[k]['axis']['id'] : null;
    yScale = recreateD3Scale(visData.y[axis]);

// TODO Add time
    dataObj.series.push(calcDataSeriesQuadtree(result, k, xScale, yScale, visData.completeSeriesConfig));

    if(visData.calcCrosshair) {
      dataObj = addCrosshairDataQuadtree(dataObj, result, visData.timeData);
    }
  }

  return dataObj;
}

/**
 * Creates the voronoi data structure which we will use to search later
 *
 * @method createVoronoi
 */
function createVoronoi(data, time) {
  var visData = data.data,
      chartData = dataMapping[data.chartId],
      result = {},
      k,
      xKey,
      yKey,
      axis,
      //we can't pass d3 scales around so we need to recretate them
      xScale = recreateD3Scale(visData.x),
      yScale;
      voronoi = d3.voronoi()
        .extent(ext)
        .x(function(d) { return this._getPixelSpaceVal(d, 'x', xKey) }.bind(this))
        .y(function(d) { return this._getPixelSpaceVal(d, 'y', yKey, axis); }.bind(this)),
        data = {};

  for(var i = 0; i < keys.length; i++) {
    k = keys[i];
    xKey = this.completeSeriesConfig[k]['x'];
    yKey = this.completeSeriesConfig[k]['y'];
    axis = this.completeSeriesConfig[k]['axis'] ? this.completeSeriesConfig[k]['axis']['id'] : null;

    data[k] = voronoi(this.chartData);
  }

  this.voronoiData = data;
}

function returnClosestsVoronoiPoints(mousePos, dataObj) {
  var keys = this.seriesKeys ? this.seriesKeys : Object.keys(this.completeSeriesConfig),
      result,
      k;

  for(var i = 0; i < keys.length; i++) {
    k = keys[i];

    // search through the voronoi for each series
    result = this.voronoiData[k].find(mousePos[0],mousePos[1], this.searchRadius);

    // if we dont find anything for that series, we need to stick in an empty to maintain our register
    if(result === null) {
      dataObj.series.push(this._emptySeries(k));

    // if we find stuff, process the data and stick it in our object
    } else {
      dataObj.time;
      dataObj.series.push(this._calcDataSeries(result, k));

      if(this._calcCrosshair) {
        dataObj = this._addCrosshairData(dataObj, result.data);
      }
    }  //else result null
  }  //for
}

function emptySeries(k) {
  return {
    "coord": [],
    "name": k,
    "value": {}
  };
}

function calcDataSeries(d, k) {
  return {
    "coord": [ d[0], d[1] ],
    "name": k,
    "value": calcVoronoiValue(d, k)
  };
}


function calcVoronoiValue(d, k) {
  var x = this.completeSeriesConfig[k]['x'],
      y = this.completeSeriesConfig[k]['y'],
      o = {};

  o[x] = d.data[x];
  o[y] = d.data[y];

  return o;
}

function addCrosshairData(dataObj, d) {
  // FIXME we can dedupe datasets with timeData this way. Need to make a way to do it for non-timedata datasets...
  if((this.timeData && !dataObj.timeStampsTracker[d[this.timeData]])) {
    dataObj.rawData.push(d);
    dataObj.timeStamps.push(d[this.timeData]);
    dataObj.timeStampsTracker[d[this.timeData]] = true;

  } else if(!this.timeData) {
    dataObj.rawData.push(d);

  }

  return dataObj;
}


onmessage = function(e) {

 // var time = this.performance.now();
 var time = null;
  switch(e.data.action) {

    case 'init':
      reply(null, time);
      break;

    case 'updateData':
      updateData(e.data, time);
      break;

    case 'createQuadtree':
      createQuadtree(e.data, time);
      break;

    case 'findQuadtreePoints':
      returnClosestsQuadtreePoints(e.data, time);
      break;

    case 'returnQuadtreeData':
      reply(quadtrees[e.data.chartId], time);
      break;

    case 'createVoronoi':
      createVoronoi(e.data, time);
      break;

    case 'findVoronoiPoints':
      returnClosestsVoronoiPoints(e.data, time);
      break;

    case 'returnVoronoiData':
      reply(voronois[e.data.chartId], time);
      break;

    default:
      reply(null, time);
  }
}
