//canvas dimensions
var w = window.innerWidth * .97;
var h = window.innerHeight * .65;

var system = {};
var simulation = null;
//running endpoints
var nextEventIndex = 0;
var currentSecond = 0;
var lastSecond = 0;
//delay speeds
var timeStepDuration = 1000;
var secsPerTimeStep = 60;
//if simulation is currently running
var running = false;
//canvas vars
var graph;
var paper;

var devices = {};
//time in seconds, minutes, etc.
var currTime = {
  seconds: 0,
  minutes: 0,
  hours: 0,
  days: 0
};
//all events displayed
var eventNames = ["power_msg", "power_out", "battery_soc", "price", "price message", "price_msg_in", "price_msg_out", "price_msg", "sell price message", "brightness", "set_point", "compressor_on_off", "request_out", "allocate_msg"]

//if the simulations is displaying events
var displayOn = true;
//event index of end event
var simEnd;
var wasRunning;

var deviceInfo = {
  air_conditioner: {
    imageUrl: "../assets/air_conditioner.png",
    defaultState: {compressor: 0, setPoint: 0}
  },
  light: {
    imageUrl: "../assets/light_bulb.png",
    defaultState: {brightness: 0}
  },
  fixed_consumption: {
    defaultState: {}
  },
  pv: {
    imageUrl: "../assets/pv_panel.png"
  },
  utm: {
    imageUrl: "../assets/utility_meter.png"
  }
} 


$(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const systemId = urlParams.get('id');
  const simId = urlParams.get('simId');
  //get simulations from server
  $.get("/api/system?id=" + systemId)
    .done(function(_system) {
      system = _system;
      displaySystem();
      console.log(_system);
      
      $("#systemName").html(system.name);
      //listing simulations
      system.simList.forEach(function(item) {
        var itemId = item.id.replace("\.", "");
        $("#simulationList").append('<a id="listItem' + itemId +'" class="simListItem"><a href="/system?id=' + systemId + '&simId='+ item.id + '"><span class="tab">' + 
        item.name + '</span></a> <a id="delete' + itemId + '" href="#" class="deleteLink"><i class="fas fa-trash-alt"></i></a></a>');
        $("#delete" + itemId).click(function() {
          console.log("deleting" + itemId);
          //ajax for deleting simulations
          $.ajax({ 
            url: '/api/simulation?id=' + item.id, 
            type: 'DELETE',
            contentType: 'application/json', 
            success: function() {
              console.log("deleted simulation");
              $("#listItem" + itemId).remove();
            }
          })
        })
      })
      //set start position if user has loaded a simulations
      if(simId){
        $.get("/api/simulation?id=" + simId)
          .done(function(_sim) {
            simulation = _sim;
            filterLogFile(simulation);
            displayTimeline();
            resetSimulation();
            $(".sim-control").removeClass("disabled");
            $("#simulationName").html(simulation.name);
            simEnd = simulation.events.length;
          })
      }

  })
  /*Save the layout of devices and links to a node
  server when a user clicks save button*/
  $("#systemSave").click(function() {
    delete system.layout.links;
    Object.keys(system.layout).forEach(function(device_id){
      system.layout[device_id].x = devices[device_id].node.attributes.position.x;
      system.layout[device_id].y = devices[device_id].node.attributes.position.y;
      if(!system.layout[device_id].links){
        system.layout[device_id].links = {};
      }
      Object.keys(devices[device_id].links).forEach(function(targetDeviceId) {
        if(!system.layout[device_id].links[targetDeviceId]){
          system.layout[device_id].links[targetDeviceId] = {};
        }
        system.layout[device_id].links[targetDeviceId].vertices = devices[device_id].links[targetDeviceId].link.vertices();
      })
    });
    console.log(system);
    $.ajax({ 
      url: '/api/system', 
      type: 'PUT',
      contentType: 'application/json', 
      data: JSON.stringify(system),
      success: function() {
        console.log("saved system");
        $("#message").html('Saved').show().delay(3200).fadeOut(300);
      }
    })
  })
  
  //run click event
  $("#runSimulation").click(function() {
    running = true;
    run();
  })
  
  //pause click event
  $("#pauseSimulation").click(function() {
    refreshAll();
    running = false;
  })
  
  //stop click event
  $("#stopSimulation").click(function() {
    running = false;
    resetSimulation();
  })
  
  $("#uploadSystemId").val(systemId); //get current system id
  
  //switch speed between seconds and minutes
  $(".radioInput").click(function(){
    var radioValue = $("input[name='radio-1']:checked").val();
    secsPerTimeStep = radioValue;
  });
  
  //get slider value
  $('#ex1').slider({
    formatter: function(value) {
     timeStepDuration = 1000 - (value * 10);
    }
  });
});

let canvasElem = document.querySelector("#scrubber"); //set scrubber as canvas element
       
//get position of click on scrubber
canvasElem.addEventListener("mousedown", function(e) { 
  handleScrubberClick(canvasElem, e); 
}); 

graph = new joint.dia.Graph;

//create sim canvas and add properties
paper = new joint.dia.Paper({
  el: document.getElementById('systemDisplay'),
  model: graph,
  width: w,
  height: h,
  gridSize: 1,
  background: {
      color: 'rgba(102, 153, 204,.4)'
  },
});

/*paper.options.defaultRouter = {
  name: 'manhattan',
  args: {
    padding: 10,
    startDirections: ['bottom'],
    endDirections: ['top']
  }
};*/

graph.on('change:position', function(cell) {

    // has an obstacle been moved? Then reroute the link.
    //if (obstacles.indexOf(cell) > -1) paper.findViewByModel(link).update();
});

paper.on('link:mouseenter', function(linkView) {
    var tools = new joint.dia.ToolsView({
        tools: [new joint.linkTools.Vertices()]
    });
    linkView.addTools(tools);
});

paper.on('link:mouseleave', function(linkView) {
    linkView.removeTools();
});

//advance total time in seconds and system clock
function advanceTime(timeStep){
  currentSecond += timeStep;
  for(var i = 0; i < timeStep; i++){
    currTime.seconds++;
    if(currTime.seconds == 60){
      currTime.minutes++;
      currTime.seconds = 0;
    }
    if(currTime.minutes == 60){
      currTime.hours++;
      currTime.minutes = 0;
    }
    if(currTime.hours == 24){
      currTime.days++;
      currTime.hours = 0;
    }
  }
}

/*Function to run the simulation taking in speed, event delays, and endpoint. 
Uses system clock to keep time and activates event displays based on time of event*/
function run(){
  var timeoutSet = false;
  while(running && nextEventIndex < simEnd){ //run while running is true and your current event index is not at the end of the simulation
    $("#time").html(currentSecond);
    $("#clock").html(currTime.days + " " + currTime.hours.toString().padStart(2, "0") + ":" + currTime.minutes.toString().padStart(2, "0") + ":" + currTime.seconds.toString().padStart(2, "0"));
    displayScrubberPosition();
    var delay; //delay between events
    var skipRate; //if sim is going on seconds or minutes
    var nextEvent = parseEvent(simulation.events[nextEventIndex]); //gets next event properties
    if(nextEvent != null && nextEvent.second == currentSecond){ //checks for existence of the next event
      $("#eventLog").prepend(nextEvent.timeStamp.day + ", " + nextEvent.timeStamp.time + ", " + nextEvent.second + ", " + nextEvent.deviceId + ", " + nextEvent.eventType + ", " +  nextEvent.action + ", " + nextEvent.value + "<br>");
      displayEvent(nextEvent);
      if((parseEvent(simulation.events[nextEventIndex+1]).second == currentSecond && parseEvent(simulation.events[nextEventIndex+2]).second == currentSecond) || (parseEvent(simulation.events[nextEventIndex-1]).second == currentSecond && parseEvent(simulation.events[nextEventIndex-2]).second == currentSecond)){
         delay = 50;
      }else{
        delay = 0;
      }
      console.log(delay);
      nextEventIndex++;
    }else{
      var timeStep = Math.min(secsPerTimeStep, nextEvent.second - currentSecond);
      advanceTime(timeStep);
      delay = timeStepDuration;
    }
    if(displayOn || nextEventIndex % 100 == 0){ //will run always with display on and once every 100 events for skip mode
      timeoutSet = true;
      setTimeout(run, delay);
      break;
    }
  }
  if(displayOn == false && !timeoutSet){ //resets running after skip has ended
    if(!wasRunning){
      running = false;
      wasRunning = true;
    }
    displayOn = true;
    simEnd = simulation.events.length;
    refreshAll();
    setTimeout(run, delay);
  }
}

//reset simulation to all starting points
function resetSimulation(){
  var firstEvent = parseEvent(simulation.events[0]);
  var lastEvent = getLastEvent();
  console.log("lastEvent", lastEvent);
  currentSecond = firstEvent.second;
  lastSecond = lastEvent.second;
  nextEventIndex = 0;
  $("#time").html(currentSecond);
  currTime.seconds = 0;
  currTime.minutes = 0;
  currTime.hours = 0;
  currTime.days = 0;
  $("#clock").html(currTime.days + " " + currTime.hours.toString().padStart(2, "0") + ":" + currTime.minutes.toString().padStart(2, "0") + ":" + currTime.seconds.toString().padStart(2, "0"));
  displaySystem();
  displayScrubberPosition();
  $("#eventLog").html("");
}

//get log to determine width of power line
function getBaseLog(x, y) {
  return Math.log(y) / Math.log(x);
}

//search log file for last event
function getLastEvent(){
  var eventSecond = 0;
  var lastEvent;
  var num = 0;
  while(eventSecond == 0 && num != simulation.events.length){
    num++;
    lastEvent = parseEvent(simulation.events[simulation.events.length-num]);
    eventSecond = lastEvent.second;
  } 
  return lastEvent;
  
}

function filterLogFile(){
  simulation.events = simulation.events.filter(event => eventNames.includes(parseEvent(event).eventType));
}

//get event from log file and convert it to a json hash
function parseEvent(eventString) {
  var comps = eventString.split(";");
  if(comps.length >= 5){
    var event = {
      timeStamp: {
        day: comps[0].trim().split(" ")[0],
        time: comps[0].trim().split(" ")[1]
      },
      second: parseInt(comps[1].trim()),
      deviceId: comps[2].trim(),
      eventType: comps[3].trim(),
      value: comps[4].trim(),
      action: comps[5].trim()
    }
    return event;
  }else{
    var event = {
      timeStamp: {
        day: 0,
        time: 0
      },
      second: 0,
      deviceId: "",
      eventType: "",
      value: 0,
      action: ""
    }
    return event;
  }
}

function lastElement(arr) {
  return arr[arr.length - 1];
}

//display all stored states of a device
function refreshDevice(device_id) {
  var device = devices[device_id];
  var deviceType = device.config.device_type;
  if(deviceType == "grid_controller"){
    device.node.attr({
      label:{
        text: device_id + " \nsoc: " + parseFloat(device.state.soc).toFixed(3) + " \n$" + parseFloat(device.state.price).toFixed(3),
        fill: 'white'
      }
    })
  }else if(deviceType == "eud"){
    if(device.config.eud_type == "air_conditioner"){
      device.node.attr({
        label:{
          text: device_id + " \ncomp: " + device.state.compressor + " \nset: " + device.state.setPoint.toFixed(3),
          fill: 'white'
        }
      })
    
    }else if(device.config.eud_type == "light"){
      device.node.attr({
        label:{
          text: device_id + "\nbright: " + device.state.brightness.toFixed(3),
          fill: 'white'
        }
      })
    }
  }else if(deviceType == "utility_meter"){
    device.node.attr({
      label:{
        text: device_id + " \n$" + parseFloat(device.state.price).toFixed(3),
        fill: 'white'
      }
    })
  }
}

//display all stores states of a link
function refreshLink(sourceDeviceId, targetDeviceId){
  var widthClasses = ["linkPower2", "linkPower3", "linkPower4", "linkPower5", "linkPower6"]; //classes for different widths of links based on power
  var link = devices[targetDeviceId].links[sourceDeviceId].link; //gets current link
  var linkView = paper.findViewByModel(link);
  var label;
  var linkState = devices[targetDeviceId].links[sourceDeviceId].state; //gets state of link
  if(linkState.power != 0){ //add widths classes and animation classes based on power of link
    var linkClass;
    if(devices[targetDeviceId].config.device_type == "utility_meter"){
      linkClass = "linkWithPowerUp";
    }else{
      linkClass = "linkWithPowerDown";
    }
    $(linkView.selectors.line).addClass(linkClass);
    widthClasses.forEach(function(e) {
       $(linkView.selectors.line).removeClass(e);
    });
    $(linkView.selectors.line).addClass(widthClasses[getLineWidth(linkState.power) - 2]);
    label = Math.abs(linkState.power) + "W";
  }else{
    label = "0W";
    $(linkView.selectors.line).removeClass("linkWithPowerDown");
    $(linkView.selectors.line).removeClass("linkWithPowerUp");
    widthClasses.forEach(function(e) {
       $(linkView.selectors.line).removeClass(e);
    });
  }
  
  //display link power
  link.label(0, {
      attrs: { text: { text: label}}
  })
  
  //for request value
  var requestLabel = (linkState.requestPower != 0)? Math.round(linkState.requestPower) + "W" : "0W";
  var allocateLabel = (linkState.allocatePower != 0)? Math.round(linkState.allocatePower) + "W" : "0W";
  
  var color = "Red";
  if(devices[targetDeviceId].links[sourceDeviceId].type == "gcLink"){
    color = "#32CD32"
  }
  if(devices[targetDeviceId].links[sourceDeviceId].type == "utmLink"){
    requestLabel = "";
    allocateLabel = "";
  }
  link.label(3, {
      attrs: { text: { text: requestLabel, fill: color}},
      position: {
        distance: .95
      }
  });
  
  //for allocate value
  
  link.label(4, {
      attrs: { text: { text: allocateLabel, fill: '#3352FF'}},
      position: {
        distance: .05
      }
  });
}

//run refreshLink and refreshDevice on all devices and links
function refreshAll(){
  Object.keys(devices).forEach(function(device_id){
    let device = devices[device_id];
    Object.keys(device.links).forEach(function(targetDeviceId){
      refreshLink(device_id, targetDeviceId);
      
    });
    refreshDevice(device_id);
  });
}

//update SOC in GC state and refreshes device
function updateSOC(grid_controller_id, soc){
  devices[grid_controller_id].state.soc = soc;
  if(displayOn){
    refreshDevice(grid_controller_id);
  }
}

//update price in device state and refreshes device
function updatePrice(device_id, price){
  devices[device_id].state.price = price;
  if(displayOn){
    refreshDevice(device_id);
  }
}
       
//update specific attribute in state of devices and display value
function updateDeviceStateValue(device_id, attribute, value){
  devices[device_id].state[attribute] = value;
  if(displayOn){
    refreshDevice(device_id);
  }
}

//update power in state of link and display the label
function updatePowerMsg(sourceDeviceId, targetDeviceId, power){
  devices[targetDeviceId].links[sourceDeviceId].state.power = power;
  refreshLink(sourceDeviceId, targetDeviceId);
}

//update request value in state of link and display the label
function updateRequestStateValue(sourceDeviceId, targetDeviceId, power){
  devices[targetDeviceId].links[sourceDeviceId].state.requestPower = power;
  if(displayOn){
    refreshLink(sourceDeviceId, targetDeviceId);
  }
}

//update allocate value in state of link and display the label
function updateAllocateStateValue(sourceDeviceId, targetDeviceId, power){
  if((sourceDeviceId.split("_")[0] == "gc" && targetDeviceId.split("_")[0] == "gc") && parseInt(sourceDeviceId.split("_")[1]) > parseInt(targetDeviceId.split("_")[1])){
    devices[targetDeviceId].links[sourceDeviceId].state.requestPower = power;
    devices[targetDeviceId].links[sourceDeviceId].state.allocatePower = power;
  }else{
    devices[targetDeviceId].links[sourceDeviceId].state.allocatePower = power;
  };
  if(displayOn){
    refreshLink(sourceDeviceId, targetDeviceId);
  }
}

//find connected GCs to a device
function findGridControllerId(device_id){
  var foundGC = system.config.devices.grid_controllers.find(function(gc) {
    return gc.connected_devices.includes(device_id);
  })
  if(foundGC != null){
    return foundGC.device_id;
  }else{
    return null;
  }
}

//switch function for running displays of different events
function displayEvent(event){
  switch(event.eventType) {
    case "power_msg":
    case "power_out":
      displayPowerMsg(event);
      break;
    case "battery_soc":
      displaySOCChange(event);
      break;
    case "price":
      displayPriceChange(event);
      break;
    case "price message":
    case "price_msg_in":
    case "price_msg_out":
      displayPriceMsg(event);
      break;
    case "price_msg":
      displayPriceChange(event);
      break;
    case "sell price message":
      displayPriceChange(event);
    case "brightness":
      displayBrightnessChange(event);
      break;
    case "set_point":
      displaySetPointChange(event);
      break;
    case "compressor_on_off":
      displayCompressorChange(event);
      break;
    case "request_out":
      displayRequestChange(event);
      break;
    case "allocate_msg":
      displayAllocateChange(event);
      break;
  }
}

//returns width of line based on power
function getLineWidth(power){
  return Math.min(Math.round(getBaseLog(4.2, Math.abs(power))), 6);
}

//get source and target of link for power message and display
function displayPowerMsg(event) {
  var power = Math.round(parseFloat(event.value));
  var powerToDeviceId = event.action.split(" ")[2];
  var sourceDeviceId, targetDeviceId;
  if(power < 0){
    sourceDeviceId = event.deviceId;
    targetDeviceId = powerToDeviceId;
  }else{
    sourceDeviceId = powerToDeviceId;
    targetDeviceId = event.deviceId;
  }
  //console.log("POWER, source: " + sourceDeviceId + ", target: " + targetDeviceId);
  updatePowerMsg(sourceDeviceId, targetDeviceId, power);
}

//update SOC of device using an event hash
function displaySOCChange(event){
  updateSOC(event.deviceId, Number((parseFloat(event.value))));
}


//display price on device
function displayPriceChange(event) {
  var price = parseFloat(event.value);
  if(price != NaN){
    var deviceId = event.deviceId;
    updatePrice(deviceId, price);
  }
}

//0 00:00:00; 0; eud_4; brightness; 0.0; brightness changed to 0.0
//display brightness of lighting devices on device
function displayBrightnessChange(event){
  var brightness = parseFloat(event.value);
  if(brightness != NaN){
    var deviceId = event.deviceId;
    updateDeviceStateValue(deviceId, "brightness", brightness);
  }
}
//0 00:00:00; 0; eud_2; set_point; 17.0; setpoint changed to 17.0
function displaySetPointChange(event){
  var setPoint = parseFloat(event.value);
  if(setPoint != NaN){
    var deviceId = event.deviceId;
    updateDeviceStateValue(deviceId, "setPoint", setPoint);
  }
}
//0 00:00:02; 2; eud_1; compressor_on_off; 1; compressor_on
//display compressor value on device
function displayCompressorChange(event){
  var compressor = event.value;
  var deviceId = event.deviceId;
  updateDeviceStateValue(deviceId, "compressor", compressor);
}

//0 00:00:00; 0; utm_1; price message; sell 0.1, buy 0; price msg to gc_1
//0 00:00:01; 1; gc_1; price_msg_in; 0.1; PRICE message from utm_1
//0 11:00:01; 39601; gc_1; price_msg_out; 0.05; PRICE to utm_1
//display price message event on link
function displayPriceMsg(event) {
  var source;
  var target;
  var price;
  if(event.eventType == "price_msg_in"){
    source = lastElement(event.action.split(" "));
    target = event.deviceId;
  }else if(event.eventType == "price_msg_out"){
    target = lastElement(event.action.split(" "));
    source = event.deviceId;
  }else{
    return;
  }
  price = event.value;
  if(displayOn){
    animatePriceMsg(source, target, price)
  };
  
}

//0 00:00:00; 0; eud_2; request_out; 500.0; REQUEST to gc_1
//display request event on link
function displayRequestChange(event){
  var power = event.value;
  var source = event.deviceId;
  var target = event.action.split(" ")[2];
  updateRequestStateValue(source, target, power);
}

//display allocate event on link
function displayAllocateChange(event){
  var power = event.value;
  var source = event.deviceId;
  var target = event.action.split(" ")[2]; 
  updateAllocateStateValue(source, target, power);
}

//display scrubber
function displayTimeline(){
  var eventIndex = 0;
  var lastEvent = getLastEvent();
  var lastHour = parseInt(lastEvent.second/3600);
  var lineWidth = parseInt(1000/lastHour);
  var currEvent;
  var currHour;
  var difference = 0;
  var powerEventsPerHour = [];
  var priceEventsPerHour = [];
  for(var i = 0; i <= lastHour; i++){
    powerEventsPerHour[i] = 0;
    priceEventsPerHour[i] = 0;
  }
  //count # of price and power messages throughout simulation
  while(eventIndex != simulation.events.length){
    currEvent = parseEvent(simulation.events[eventIndex]);
    currHour = parseInt(currEvent.second/3600);
    if(currEvent.eventType == 'power_msg' || currEvent.eventType == 'power_out'){
      powerEventsPerHour[currHour]++;
    }else if(currEvent.eventType == 'price_msg_in' || currEvent.eventType == 'price_msg_out' || currEvent.eventType == 'price message'){
      priceEventsPerHour[currHour]++;
    }
    eventIndex++;
  }
  var maxPowerEvents = Math.max.apply(null, powerEventsPerHour);
  var maxPriceEvents = Math.max.apply(null, priceEventsPerHour);
  var powerWidths = [];
  var priceWidths = [];
  for(var l = 0; l < lastHour; l++){
    powerWidths[l] = parseInt(lineWidth * (powerEventsPerHour[l]/maxPowerEvents));
    priceWidths[l] = parseInt(lineWidth * (priceEventsPerHour[l]/maxPriceEvents));
  }

  var canvas = document.getElementById('eventCanvas');
  //change color of scrubber based on # of price and power events
  if (canvas.getContext) {
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'orange';
    for(var k = 0; k < powerWidths.length; k++){
      ctx.fillRect(k*lineWidth, 0, powerWidths[k], 550)
    }
    ctx.fillStyle = 'green';
    for(var j = 0; j < priceWidths.length; j++){
      ctx.fillRect(j*lineWidth, 0, priceWidths[j], 550)
    }
  }
}

//move price msg along link
function animatePriceMsg(sourceId, targetId, price) {
  var link = devices[sourceId].links[targetId].link;
  var startPos;
  var direction;
  if(link.getSourceElement().prop("deviceId") == sourceId){
    startPos = 0;
    direction = 1;
  }else{
    startPos = 100;
    direction = -1;
  }
  
  
  advancePriceMsg(link, startPos, direction, price);
}

function advancePriceMsg(link, currPos, direction, price){
  //console.log("displaying price change of " + link);
  if(displayOn){
    var labelNum = (direction == 1? 1:2);
    if((direction == 1 && currPos == 0) || (direction == -1 && currPos == 100)){
      link.label(labelNum, {
        attrs: { text: { text: '$' + parseFloat(price).toFixed(3)}}    
      });
    }
    if((direction == 1 && currPos != 100) || (direction == -1 && currPos != 0)){
      link.label(labelNum, {
        position: {
          distance: currPos / 100
        }
      });
      setTimeout(function(){
        advancePriceMsg(link, currPos + (direction * 2), direction, price)
      }, 10);
    }else{
      link.label(labelNum, {
        attrs: { text: { text: ""}},
        position: {
          distance: 0
        }
      });
    }
  }
}

function createLink(sourceId, targetId) {
  var type = "normalLink";
  var startingValue = "0W";
  var bottomLabelColor = "Red";
  if(sourceId.split("_")[0] == "gc" && targetId.split("_")[0] == "gc"){
    type = "gcLink";
    bottomLabelColor = '#32CD32';
    startingValue = "0W";
  }else if(sourceId.split("_")[0] == "utm" || targetId.split("_")[0] == "utm"){
    type = "utmLink";
    startingValue = "";
  }
  var sourceLayout = system.layout[sourceId];
  var link = new joint.shapes.standard.Link({
    source: devices[sourceId].node,
    target: devices[targetId].node,
    vertices: sourceLayout.links && sourceLayout.links[targetId] ? sourceLayout.links[targetId].vertices : null,
    attrs: {
      line: {
        targetMarker: {
            // the marker can be an arbitrary SVGElement
            'type': 'circle',
            'r': 0
        }
      }
    },
    labels: [{ //power label
      attrs: { text: { text: '0W' }},
      position: {
        offset: 0,
        distance: 0.5
      }
    },
    { //direction 1 price msg
      attrs: { text: { text: '', fill: '#16D10A'  }},
      position: {
        offset: 0,
        distance: 0
      }
    },
    { //direction -1 price msg
      attrs: { text: { text: '', fill: '#16D10A'  }},
      position: {
        offset: 0,
        distance: 0
      }
    },
    { // request label
      attrs: { text: { text: startingValue, fill: bottomLabelColor }},
      position: {
        offset: 0,
        distance: .95
      }
    },
    { //allocate label
      attrs: { text: { text: startingValue, fill: '#3352FF' }},
      position: {
        offset: 0,
        distance: .05
      }
    }]
  });
  var linkData = {
    state: {
      power: 0,
      allocatePower: 0,
      requestPower: 0
    },
    link: link,
    type: type
  };
  devices[targetId].links[sourceId] = linkData;
  devices[sourceId].links[targetId] = linkData;
  link.addTo(graph);
  return link;
} 

function displayScrubberPosition(){
  var position = (currentSecond/lastSecond) * 100;
  $("#locationBar").css("left", position + "%");
};

function handleScrubberClick(canvas, event) {
  let canvasWidth = canvas.scrollWidth;
  let rect = canvas.getBoundingClientRect(); 
  let x = event.clientX - rect.left;
  let xPer = Math.round((x / canvasWidth) * 100);
  simEnd = Math.round((xPer/100) * simulation.events.length);
  if(simEnd < nextEventIndex){
    resetSimulation();
  }
  if(!running){
    wasRunning = false;
    running = true;
    run();
  }else{
    wasRunning = true;
  }

  displayOn = false;
} 

function displaySystem(){
  devices = {};
  graph.clear();
  var xPos = 100;
  var yPos = 30;
  if(system.config.devices.pvs){
    system.config.devices.pvs.forEach(function(pv){
      var rect = new joint.shapes.standard.EmbeddedImage();
      if(system.layout[pv.device_id]){
        xPos = system.layout[pv.device_id].x;
        yPos = system.layout[pv.device_id].y;
      } else {
        system.layout[pv.device_id] = {};
        system.layout[pv.device_id].x = xPos;
        system.layout[pv.device_id].y = yPos;
      }
      rect.position(xPos, yPos);
      rect.resize(100, 50);
      rect.prop({deviceId: pv.device_id});
      rect.attr({
          body: {
              fill: 'green'
          },
          label: {
              text: pv.device_id,
              fill: 'white'
          },
          image: {
            xlinkHref: deviceInfo.pv.imageUrl
          }
      });
      rect.addTo(graph);
      pv.device_type = "pv";//Missing in example-config
      devices[pv.device_id] = {};
      devices[pv.device_id].config = pv;
      devices[pv.device_id].node = rect;
      devices[pv.device_id].links = {};
      devices[pv.device_id].state = {};
      devices[pv.device_id].rank = 0;
      xPos = xPos + 150;
    })
  }
  if(system.config.devices.utility_meters){
    system.config.devices.utility_meters.forEach(function(utm){
      var rect = new joint.shapes.standard.EmbeddedImage();
      if(system.layout[utm.device_id]){
        xPos = system.layout[utm.device_id].x;
        yPos = system.layout[utm.device_id].y;
      } else {
        system.layout[utm.device_id] = {};
        system.layout[utm.device_id].x = xPos;
        system.layout[utm.device_id].y = yPos;
      }
      rect.position(xPos, yPos);
      rect.resize(100, 50);
      rect.prop({deviceId: utm.device_id});
      rect.attr({
          body: {
              fill: 'blue'
          },
          label: {
              text: utm.device_id,
              fill: 'white'
          },
          image: {
            xlinkHref: deviceInfo.utm.imageUrl
          }
      });
      rect.addTo(graph);
      utm.device_type = "utility_meter";
      devices[utm.device_id] = {};
      devices[utm.device_id].config = utm;
      devices[utm.device_id].node = rect;
      devices[utm.device_id].links = {};
      devices[utm.device_id].state = {price: 0.000};
      devices[utm.device_id].rank = 0;
      xPos = xPos + 150;
      refreshDevice(utm.device_id);
    })
  }
  xPos = 100;
  yPos = 140;
  if(system.config.devices.grid_controllers){
    system.config.devices.grid_controllers.forEach(function(gc){
      var rect = new joint.shapes.standard.Rectangle();
      if(system.layout[gc.device_id]){
        xPos = system.layout[gc.device_id].x;
        yPos = system.layout[gc.device_id].y;
      } else {
        system.layout[gc.device_id] = {};
        system.layout[gc.device_id].x = xPos;
        system.layout[gc.device_id].y = yPos;
      }
      rect.position(xPos, yPos);
      rect.resize(100, 60);
      rect.prop({deviceId: gc.device_id});
      rect.attr({
        body: {
            fill: 'grey'
        },
        label: {
            text: gc.device_id,
            fill: 'white'
        }
      });
      rect.addTo(graph);
      gc.device_type = "grid_controller";
      devices[gc.device_id] = {};
      devices[gc.device_id].config = gc;
      devices[gc.device_id].node = rect;
      devices[gc.device_id].links = {};
      devices[gc.device_id].state = {soc: 0.000, price: 0.000};
      devices[gc.device_id].rank = 1;
      xPos = xPos + 150;
      refreshDevice(gc.device_id);
      //updateSOC(gc.device_id, gc.battery['starting soc']);
    })
  }
  xPos = 100;
  yPos = 250;
  if(system.config.devices.euds){
    system.config.devices.euds.forEach(function(eud){
      var rect = new joint.shapes.standard.EmbeddedImage();
      if(system.layout[eud.device_id]){
        xPos = system.layout[eud.device_id].x;
        yPos = system.layout[eud.device_id].y;
      } else {
        system.layout[eud.device_id] = {};
        system.layout[eud.device_id].x = xPos;
        system.layout[eud.device_id].y = yPos;
      }
      rect.position(xPos, yPos);
      rect.resize(150, 55)
      rect.prop({deviceId: eud.device_id});
      if(deviceInfo[eud.eud_type]){
        rect.attr('image/xlinkHref', deviceInfo[eud.eud_type].imageUrl);
      }
      rect.attr({
          body: {
              fill: 'orange'
          },
          label: {
              text: eud.device_id,
              fill: 'white'
          }
      });
      rect.addTo(graph);
      eud.device_type = "eud"
      devices[eud.device_id] = {};
      devices[eud.device_id].config = eud;
      devices[eud.device_id].node = rect;
      devices[eud.device_id].links = {};
      devices[eud.device_id].state = deviceInfo[eud.eud_type].defaultState;
      devices[eud.device_id].rank = 1;
      xPos = xPos + 150;
      refreshDevice(eud.device_id);
    })
  }
  if(system.config.devices.pvs){
  system.config.devices.pvs.forEach(function(pv){
    if(!pv.grid_controller_id){
      pv.grid_controller_id = findGridControllerId(pv.device_id);
    }
    if(pv.grid_controller_id){
      createLink(pv.device_id, pv.grid_controller_id);
    }
  })
  }
  if(system.config.devices.utility_meters){
  system.config.devices.utility_meters.forEach(function(utm){
    if(!utm.grid_controller_id){
      utm.grid_controller_id = findGridControllerId(utm.device_id);
    }
    if(utm.grid_controller_id){
      createLink(utm.device_id, utm.grid_controller_id);
    }
  })
  }
  if(system.config.devices.euds){
  system.config.devices.euds.forEach(function(eud){
    if(!eud.grid_controller_id){
      eud.grid_controller_id = findGridControllerId(eud.device_id);
    }
    if(eud.grid_controller_id){
      createLink(eud.grid_controller_id, eud.device_id);
    }
  })
  }
  if(system.config.devices.grid_controllers){
    system.config.devices.grid_controllers.forEach(function(gc){
      /*if(!gc.grid_controller_id){
        gc.grid_controller_id = findGridControllerId(gc.device_id);
      }*/
      gc.connected_devices.forEach(function(deviceName){
        if(deviceName.split("_")[0] == "gc"){
          createLink(gc.device_id, deviceName);
        }
      })  
    })
  }
}