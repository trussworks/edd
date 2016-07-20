/// <reference path="../typings/d3/d3.d.ts"/>;
/// <reference path="GraphHelperMethods.ts" />
var StudyDGraphing;
StudyDGraphing = {
    Setup: function (graphdiv) {
        if (graphdiv) {
            this.graphDiv = $("#" + graphdiv);
        }
        else {
            this.graphDiv = $("#graphDiv");
        }
    },
    clearAllSets: function () {
        var divs = this.graphDiv.siblings();
        if ($(divs[1]).find("svg").length == 0) {
            d3.selectAll("svg").remove();
        }
        else {
            for (var div = 1; div < divs.length; div++) {
                $(divs[div]).find("svg").remove();
            }
        }
    },
    addNewSet: function (newSet) {
        var buttonArr = StudyDGraphing.getButtonElement(this.graphDiv);
        var buttons = StudyDGraphing.convertArrToObject(buttonArr);
        var selector = StudyDGraphing.getSelectorElement(this.graphDiv);
        //bar chart grouped by time
        d3.select(buttons["timeBar"])
            .on('click', function () {
            event.preventDefault();
            d3.select(selector[1]).style('display', 'none');
            d3.select(selector[2]).style('display', 'block');
            d3.select(selector[3]).style('display', 'none');
            d3.select(selector[4]).style('display', 'none');
            return false;
        });
        //line chart
        d3.select(buttons["linechart"])
            .on('click', function () {
            event.preventDefault();
            d3.select(selector[1]).style('display', 'block');
            d3.select(selector[2]).style('display', 'none');
            d3.select(selector[3]).style('display', 'none');
            d3.select(selector[4]).style('display', 'none');
            return false;
        });
        //bar charts for each line entry
        d3.select(buttons["single"])
            .on('click', function () {
            event.preventDefault();
            d3.select(selector[1]).style('display', 'none');
            d3.select(selector[2]).style('display', 'none');
            d3.select(selector[3]).style('display', 'block');
            d3.select(selector[4]).style('display', 'none');
            return false;
        });
        //bar chart grouped by assay
        d3.select(buttons["groupedAssay"])
            .on('click', function () {
            event.preventDefault();
            d3.select(selector[1]).style('display', 'none');
            d3.select(selector[2]).style('display', 'none');
            d3.select(selector[3]).style('display', 'none');
            d3.select(selector[4]).style('display', 'block');
            return false;
        });
        var data = EDDData; // main data
        var barAssayObj = GraphHelperMethods.sortBarData(newSet);
        var x_units = GraphHelperMethods.findX_Units(barAssayObj);
        var y_units = GraphHelperMethods.findY_Units(barAssayObj);
        //data for graphs
        var graphSet = {
            barAssayObj: GraphHelperMethods.sortBarData(newSet),
            labels: GraphHelperMethods.names(data),
            y_unit: GraphHelperMethods.displayUnit(y_units),
            x_unit: GraphHelperMethods.displayUnit(x_units),
            create_x_axis: GraphHelperMethods.createXAxis,
            create_y_axis: GraphHelperMethods.createYAxis,
            x_axis: GraphHelperMethods.make_x_axis,
            y_axis: GraphHelperMethods.make_y_axis,
            individualData: newSet,
            assayMeasurements: barAssayObj,
            legend: GraphHelperMethods.legend,
            color: d3.scale.category10(),
            width: 750,
            height: 220
        };
        //create respective graphs
        createLineGraph(graphSet, GraphHelperMethods.createSvg(selector[1]));
        createTimeGraph(graphSet, GraphHelperMethods.createSvg(selector[2]));
        createSideBySide(graphSet, selector[3]);
        createAssayGraph(graphSet, GraphHelperMethods.createSvg(selector[4]));
        if (!newSet.label) {
            $('#debug').text('Failed to fetch series.');
            return;
        }
    },
    /* this function takes in element and returns an array of selectors
    * [<div id=​"linechart">​</div>​, <div id=​"timeBar">​</div>​, <div id=​"single">​</div>​,
    * <div id=​"groupedAssay">​</div>​]
    */
    getButtonElement: function (element) {
        if (($(element).siblings().siblings()).size() < 7) {
            return $(element.siblings()[0]).find("button");
        }
        else {
            return $(element.siblings()[1]).find("button");
        }
    },
    // this function takes in the graphDiv element and returns an array of 4 buttons
    getSelectorElement: function (element) {
        return element.siblings().siblings();
    },
    // this function takes in and array and returns an object
    convertArrToObject: function (arr) {
        var rv = {};
        for (var i = 0; i < arr.length; ++i) {
            var key = arr[i].value;
            rv[key] = arr[i];
        }
        return rv;
    },
};
