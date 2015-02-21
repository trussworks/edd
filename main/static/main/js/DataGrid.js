/// <reference path="typescript-declarations.d.ts" />
/// <reference path="Utl.ts" />
/// <reference path="Dragboxes.ts" />
/// <reference path="lib/jquery.d.ts" />
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
//
// This is a re-implementation of DataGridServerSide for wholly client-side tables.
// Eventually DataGridServerSide should be phased out completely.
//
var DataGrid = (function () {
    // This binds a table element to an instance of DataGrid.
    // The previous contents of the table, if any, are deleted, and DataGrid takes over the table
    function DataGrid(dataGridSpec) {
        var _this = this;
        this._groupingEnabled = false; // grouping mode off by default
        this._sortHeaderPrevious = null;
        // Use !! double-not operator to coerce truth-y/false-y values to booleans
        Utl.JS.assert(!!dataGridSpec, "DataGrid needs to be supplied with a DataGridSpecBase-derived object.");
        Utl.JS.assert(!!(dataGridSpec.tableElement && dataGridSpec.tableSpec && dataGridSpec.tableHeaderSpec && dataGridSpec.tableColumnSpec), "DataGridSpecBase-derived object does not have enough to work with.");
        //
        // Member variable declarations
        //
        // We need a DataGridSpecBase-derived table specification.
        // (This object describes the table and implements custom functionality
        // that belongs with whoever created the table.)
        // (See the DataGridSpecBase class to see what can be implemented.)
        this._spec = dataGridSpec;
        this._table = dataGridSpec.tableElement;
        this._timers = {};
        var tableBody = $(this._tableBody = document.createElement("tbody"));
        // First step: Blow away the old contents of the table
        $(this._table).empty().attr({ 'cellpadding': 0, 'cellspacing': 0 }).addClass('dataTable sortable dragboxes hastablecontrols').append(tableBody);
        var tableHeaderRow = $(document.createElement("tr")).addClass('header');
        var tableHeaderCell = $(this._tableHeaderCell = document.createElement("th")).appendTo(tableHeaderRow);
        if (dataGridSpec.tableSpec.name) {
            $(this.tableTitleSpan = document.createElement("span")).text(dataGridSpec.tableSpec.name).appendTo(tableHeaderCell);
        }
        var waitBadge = $(this._waitBadge = document.createElement("span")).addClass('waitbadge wait').appendTo(tableHeaderCell);
        if ((this._totalColumnCount = this.countTotalColumns()) > 1) {
            tableHeaderCell.attr('colspan', this._totalColumnCount);
        }
        // If we're asked to show the header, then add it to the table.  Otherwise we will leave it off.
        if (dataGridSpec.tableSpec.showHeader) {
            tableBody.append(tableHeaderRow);
        }
        // Apply the default column visibility settings.
        // TODO: Read in the user-defined column visibility hash and apply it before first rendering the table
        this.prepareColumnVisibility(null);
        var headerRows = this._headerRows = this._buildTableHeaders();
        this._headerRows.forEach(function (v) { return tableBody.append(v); });
        setTimeout(function () { return _this._initializeTableData(); }, 1);
    }
    // Breaking up the initial table creation into two stages allows the browser to render a preliminary
    // version of the table with a header but no data rows, then continue loading other assets in parallel.
    // It actually speeds up the entire table creation as well, for reasons that are not very clear.
    // (If the setup is NOT run in two stages, all the 'createElement' calls for the data cells take much longer,
    // in Firefox and Safari, according to load-time profiling ... and only when paired with some servers??)
    DataGrid.prototype._initializeTableData = function () {
        var hCell = this._tableHeaderCell;
        this._buildAllTableSorters()._buildTableSortSequences()._allocateTableRowRecords()._buildRowGroupTitleRows()._createOptionsMenu()._createHeaderWidgets();
        // First, append the header widgets that should to appear "after" the pulldown.
        // (Since all widgets are styled to float right, they will appear from right to left.)
        this._headerWidgets.forEach(function (widget, index) {
            if (!widget.displayBeforeViewMenu()) {
                widget.appendElements(hCell, index.toString(10));
            }
        });
        // Now append the 'View' pulldown menu
        hCell.appendChild(this._optionsMenuElement);
        // Finally, append the header widgets that should appear "before".
        this._headerWidgets.forEach(function (widget, index) {
            if (widget.displayBeforeViewMenu()) {
                widget.appendElements(hCell, index.toString(10));
            }
        });
        this._sortHeaderCurrent = this._spec.tableHeaderSpec[this._spec.tableSpec.defaultSort || 0];
        this.arrangeTableDataRows();
        // Now that we've constructed our elements, apply visibility styling to them.
        this._applyColumnVisibility();
        // Prepare the table for sorting
        this._prepareSortable();
        this._spec.onInitialized(this);
        $(this._waitBadge).addClass('off');
        return this;
    };
    // Notify the DataGrid that its underlying data has reset
    DataGrid.prototype.triggerDataReset = function () {
        var _this = this;
        // We have new data to display. Clear out old rows.
        $.each(this._recordElements, function (index, value) {
            value.removeElements();
        });
        this._spec.onDataReset(this);
        // Rebuild rows.
        this._buildTableSortSequences()._allocateTableRowRecords().arrangeTableDataRows();
        // Call the support function in each widget, to apply styling to all the data rows of the table.
        this._optionsMenuWidgets.forEach(function (widget) {
            _this._spec.getRecordIDs().forEach(function (id) {
                widget.initialFormatRowElementsForID(_this._recordElements[id].getDataGridDataRows(), id);
            });
        });
        this._headerWidgets.forEach(function (widget) {
            _this._spec.getRecordIDs().forEach(function (id) {
                widget.initialFormatRowElementsForID(_this._recordElements[id].getDataGridDataRows(), id);
            });
        });
        // And make sure only the currently visible things are ... visible
        this._applyColumnVisibility();
        this._headerWidgets.forEach(function (widget, index) {
            widget.refreshWidget();
        });
        this._optionsMenuWidgets.forEach(function (widget, index) {
            widget.refreshWidget();
        });
        return this;
    };
    // Update only the table rows for the specified records.
    // For use in situations where you want to add rows, or rebuild existing rows,
    // and leave the rest unchanged.
    DataGrid.prototype.triggerPartialDataReset = function (recordIDs, reflow) {
        var _this = this;
        this._spec.onPartialDataReset(this, recordIDs);
        // Rebuild rows.
        recordIDs.forEach(function (id) {
            _this.reconstructSingleRecord(id);
        });
        if (reflow) {
            this._buildTableSortSequences().arrangeTableDataRows();
            this._headerWidgets.forEach(function (widget, index) {
                widget.refreshWidget();
            });
            this._optionsMenuWidgets.forEach(function (widget, index) {
                widget.refreshWidget();
            });
        }
        return this;
    };
    // Instruct DataGrid to recreate/refresh everything related to a single record ID.
    // This includes removing its table rows, reconstructing them, reformatting them, and
    // re-adding the rows in the same place as the old, but does NOT rebuild the sort sequences.
    //   NOTE:
    // It's quite possible that changes to the appearance will alter the visibility of the rows in
    // complicated ways.  For example, the generic search widget logic may decide to hide a previously shown
    // row or vice-versa, corrupting row striping.  Do not delay the reflow for too long.
    DataGrid.prototype.reconstructSingleRecord = function (recordID) {
        if (this._recordElements[recordID]) {
            this._recordElements[recordID].reCreateElementsInPlace();
        }
        else {
            // Note that if the record didn't exist before, it will not appear in the table now,
            // until a complete reflow is done by rebuilding sort sequences and calling arrangeTableDataRows.
            this._recordElements[recordID] = new DataGridRecord(this._spec, recordID);
        }
        var dgRecord = this._recordElements[recordID];
        // Call the support function in each widget, to apply styling to all the data rows of the table.
        this._optionsMenuWidgets.forEach(function (widget) {
            widget.initialFormatRowElementsForID(dgRecord.getDataGridDataRows(), recordID);
        });
        this._headerWidgets.forEach(function (widget) {
            widget.initialFormatRowElementsForID(dgRecord.getDataGridDataRows(), recordID);
        });
        // Make sure only the currently visible things are ... visible
        this._applyColumnVisibilityToOneRecord(recordID);
        return this;
    };
    DataGrid.prototype._createOptionsMenu = function () {
        var _this = this;
        var mainID = this._spec.tableSpec.id;
        // Populate the master list of custom options menu widgets by calling the initialization routine in the spec
        this._optionsMenuWidgets = this._spec.createCustomOptionsWidgets(this);
        var hasCustomWidgets = this._optionsMenuWidgets.length > 0;
        // Check in the column groups and see if any are hide-able
        var hasColumnsInVisibilityList = this._spec.tableColumnGroupSpec.some(function (group) {
            return group.showInVisibilityList;
        });
        // If none of the groups are allowed to be hidden, and we don't have any custom option widgets,
        // don't bother creating the column visibility menu
        if (!hasColumnsInVisibilityList && !hasCustomWidgets) {
            return;
        }
        // If we have custom widgets, we need to call their support functions that apply styling
        // to all the data rows of the table.
        if (hasCustomWidgets) {
            this._optionsMenuWidgets.forEach(function (widget) {
                _this._spec.getRecordIDs().forEach(function (id) {
                    widget.initialFormatRowElementsForID(_this._recordElements[id].getDataGridDataRows(), id);
                });
            });
        }
        var mainSpan = $(this._optionsMenuElement = document.createElement("span")).attr('id', mainID + 'ColumnChooser').addClass('pulldownMenu');
        var menuLabelOn = $(this._optionsLabelOnElement = document.createElement("div")).addClass('pulldownMenuLabelOn off').text('View\u25BE').click(function () { return _this._clickedOptMenuWhileOn(); }).appendTo(mainSpan);
        var menuLabelOff = $(this._optionsLabelOffElement = document.createElement("div")).addClass('pulldownMenuLabelOff').text('View\u25BE').click(function () { return _this._clickedOptMenuWhileOff(); }).appendTo(mainSpan);
        var menuBlock = $(this._optionsMenuBlockElement = document.createElement("div")).addClass('pulldownMenuMenuBlock off').appendTo(mainSpan);
        if (hasCustomWidgets) {
            var menuCWList = $(document.createElement("ul")).appendTo(menuBlock);
            if (hasColumnsInVisibilityList) {
                menuCWList.addClass('withDivider');
            }
            this._optionsMenuWidgets.forEach(function (widget, index) {
                widget.appendElements($(document.createElement("li")).appendTo(menuCWList)[0], index.toString(10));
            });
        }
        if (hasColumnsInVisibilityList) {
            var menuColList = $(document.createElement("ul")).appendTo(menuBlock);
            // Add each hide-able group to the menu.
            // Note: We have to walk through this anew, because we're going to make use of the index 'i'.
            this._spec.tableColumnGroupSpec.forEach(function (group, index) {
                if (!group.showInVisibilityList) {
                    return;
                }
                var item = $(document.createElement("li")).appendTo(menuColList);
                var id = mainID + 'ColumnCheckbox' + (index + 1);
                var checkbox = $(group.checkboxElement = document.createElement("input")).appendTo(item).attr({ 'id': id, 'name': id, 'value': index + 1 }).click(function (e) { return _this._clickedColVisibilityControl(e); });
                group.checkboxElement.type = 'checkbox'; // cannot set this via jQuery
                if (!group.currentlyHidden) {
                    checkbox.prop('checked', true);
                }
                $(document.createElement("label")).appendTo(item).attr('for', id).text(group.name);
            });
        }
        return this;
    };
    DataGrid.prototype._createHeaderWidgets = function () {
        var _this = this;
        // Populate the master list of custom header widgets by calling the initialization routine in the spec
        this._headerWidgets = this._spec.createCustomHeaderWidgets(this);
        this._headerWidgets.forEach(function (widget) {
            // Call the support function in each widget, to apply styling to all the data rows of the table.
            _this._spec.getRecordIDs().forEach(function (id) {
                widget.initialFormatRowElementsForID(_this._recordElements[id].getDataGridDataRows(), id);
            });
        });
        return this;
    };
    // Prepare the column visibility state for the table.
    // If given a flagHash object, look in the object for attributes matching the column group IDs,
    // and enable or disable the column groups accordingly.
    // This function should be called during instantiation, since it initializes the column visibility
    // variables that are referred to throughout the rest of the DataGrid class.
    // TODO: Call the 'made visible' spec callback for any columns that are initially visible
    DataGrid.prototype.prepareColumnVisibility = function (flagHash) {
        var _this = this;
        // First, run through a sequence of checks to set the 'currentlyHidden' attribute to a reasonable value.
        this._spec.tableColumnGroupSpec.forEach(function (group, index) {
            // Establish what the default is, before checking any passed-in column flags
            group.currentlyHidden = !!group.hiddenByDefault;
            if (flagHash) {
                // Column groups are numbered starting from 1, so when we prepare the 0th group,
                // we need to check in the hash for the attribute 1.
                group.currentlyHidden = !flagHash[index + 1];
            }
            // Ensure that the necessary arrays are present to keep track of group members
            group.memberHeaders = group.memberHeaders || [];
            group.memberColumns = group.memberColumns || [];
        });
        // Collect all the headers under their respective column groups
        this._spec.tableHeaderSpec.forEach(function (header) {
            var c = header.columnGroup;
            if (c && _this._spec.tableColumnGroupSpec[c - 1]) {
                _this._spec.tableColumnGroupSpec[c - 1].memberHeaders.push(header);
            }
        });
        // Collect all the columns (and in turn their cells) under their respective column groups
        this._spec.tableColumnSpec.forEach(function (col) {
            var c = col.columnGroup;
            if (c && _this._spec.tableColumnGroupSpec[c - 1]) {
                _this._spec.tableColumnGroupSpec[c - 1].memberColumns.push(col);
            }
        });
    };
    // Read the current column visibility state and alter the styling of headers and cells to reflect it
    DataGrid.prototype._applyColumnVisibility = function () {
        this._spec.tableColumnGroupSpec.forEach(function (group) {
            var hidden = group.currentlyHidden;
            group.memberHeaders.forEach(function (header) { return $(header.element).toggleClass('off', hidden); });
            group.memberColumns.forEach(function (column) {
                column.getEntireIndex().forEach(function (c) { return hidden ? c.hide() : c.unhide(); });
            });
        });
        return this;
    };
    DataGrid.prototype._applyColumnVisibilityToOneRecord = function (recordID) {
        this._spec.tableColumnGroupSpec.forEach(function (group) {
            var hidden = group.currentlyHidden;
            group.memberColumns.forEach(function (column) {
                column.cellIndexAtID(recordID).forEach(function (c) { return hidden ? c.hide() : c.unhide(); });
            });
        });
        return this;
    };
    // Return a copy of the array of DataGridDataCell objects, for the column at the given index in the spec.
    DataGrid.prototype.getDataCellObjectsForColumnIndex = function (i) {
        if (this._spec.tableColumnSpec[i]) {
            return this._spec.tableColumnSpec[i].getEntireIndex();
        }
        return [];
    };
    // Get the list of IDs, then filter it down to what's visible,
    // then search the visible rows for spec-mandated checkbox elements,
    // and if a checkbox is checked, return its element on an array.
    DataGrid.prototype.getSelectedCheckboxElements = function () {
        var _this = this;
        var sequence = this._sortHeaderCurrent.sortSequence;
        // Verify that the row sets referred to by the IDs actually exist
        var filteredSequence = sequence.filter(function (v) {
            return !!_this._recordElements[v];
        });
        filteredSequence = this.applyAllWidgetFiltering(filteredSequence);
        var checkedBoxes = [];
        filteredSequence.forEach(function (v) {
            var rows = _this._recordElements[v].getDataGridDataRows();
            rows.forEach(function (row) {
                if (!row.dataGridDataCells) {
                    return;
                }
                row.dataGridDataCells.forEach(function (cell) {
                    var checkbox = cell.getCheckboxElement();
                    if (checkbox && checkbox.checked) {
                        checkedBoxes.push(checkbox);
                    }
                });
            });
        });
        return checkedBoxes;
    };
    DataGrid.prototype.arrangeTableDataRows = function () {
        var _this = this;
        var currentSortHeader = this._sortHeaderCurrent;
        var striping = 1;
        // We create a document fragment - a kind of container for document-related objects that we don't
        // want in the page - and accumulate inside it all the rows we want to display, in sorted order.
        var frag = document.createDocumentFragment();
        // We need to track which header was the last to sort this table,
        // If that reference is null, the table is being displayed sorted for the first time.
        var lastSorted = this._sortHeaderPrevious === null ? this._sortHeaderCurrent : this._sortHeaderPrevious;
        $(lastSorted.element).removeClass('sortedup sorteddown');
        var isReversed = currentSortHeader.sortCurrentlyReversed;
        // Update CSS styles to reflect which direction it's sorted in.
        $(currentSortHeader.element).removeClass('sortwait').addClass(isReversed ? 'sorteddown' : 'sortedup');
        // If we're in reversed mode, use the reversed version of the sort sequence
        var sequence = isReversed ? currentSortHeader.sortSequenceReversed : currentSortHeader.sortSequence;
        // Verify that the row sets referred to by the IDs actually exist
        var filteredSequence = sequence.filter(function (v) {
            return !!_this._recordElements[v];
        });
        var unfilteredSequence = filteredSequence.slice(0);
        // Remove all the grouping title rows from the table as well, if they were there
        var rowGroupSpec = this._spec.tableRowGroupSpec;
        rowGroupSpec.forEach(function (rowGroup) {
            var r = rowGroup.disclosedTitleRow;
            if (r.parentNode) {
                _this._tableBody.removeChild(r);
            }
            r = rowGroup.undisclosedTitleRow;
            if (r.parentNode) {
                _this._tableBody.removeChild(r);
            }
            // While we're here, reset the member record arrays.  We need to rebuild them post-filtering.
            rowGroup.memberRecords = [];
        });
        filteredSequence = this.applyAllWidgetFiltering(filteredSequence);
        // Call to detach only the rows that didn't make it through the filter.
        // The others will be automatically detached by being moved to the document fragment.
        var addedRowIDs = {};
        filteredSequence.forEach(function (id) {
            addedRowIDs[id] = true;
        });
        unfilteredSequence.forEach(function (id) {
            if (!addedRowIDs[id]) {
                _this._recordElements[id].detachElements();
            }
        });
        // Now we run through the remaining IDs and add their rows to the table, with striping.
        // But if grouping is enabled and there is at least one group, we add them a few at a time,
        // proceeding through each group.
        if (!this._groupingEnabled || rowGroupSpec.length < 1) {
            if (this._spec.tableSpec.applyStriping) {
                filteredSequence.forEach(function (s) {
                    striping = 1 - striping;
                    _this._recordElements[s].applyStriping(striping);
                });
            }
            filteredSequence.forEach(function (s) {
                var rows = _this._recordElements[s].getElements();
                rows.forEach(function (row) {
                    frag.appendChild(row);
                });
            });
        }
        else {
            var stripeStyles = ['stripeRowA', 'stripeRowB'];
            var stripeStylesJoin = stripeStyles.join(' ');
            filteredSequence.forEach(function (s) {
                var rowGroup = rowGroupSpec[_this._spec.getRowGroupMembership(s)];
                rowGroup.memberRecords.push(_this._recordElements[s]);
            });
            rowGroupSpec.forEach(function (rowGroup) {
                if (rowGroup.memberRecords.length < 1) {
                    // If there's nothing in the group (may have all been filtered out) skip it
                    return;
                }
                striping = 1 - striping;
                if (_this._spec.tableSpec.applyStriping) {
                    rowGroup.undisclosedTitleRowJQ.add(rowGroup.disclosedTitleRowJQ).removeClass(stripeStylesJoin).addClass(stripeStyles[striping]).end();
                }
                if (!rowGroup.disclosed) {
                    // If the group is not disclosed, just print the "undisclosed" title row, and skip the
                    // rows themselves (but invert the striping value so the striping pattern isn't disturbed)
                    frag.appendChild(rowGroup.undisclosedTitleRow);
                    return;
                }
                frag.appendChild(rowGroup.disclosedTitleRow);
                rowGroup.memberRecords.forEach(function (record) {
                    striping = 1 - striping;
                    if (_this._spec.tableSpec.applyStriping) {
                        record.applyStriping(striping);
                    }
                    var rows = record.getElements();
                    rows.forEach(function (row) {
                        frag.appendChild(row);
                    });
                });
            });
        }
        // Remember that we last sorted by this column
        this._sortHeaderPrevious = currentSortHeader;
        this._tableBody.appendChild(frag);
    };
    // Given an array of record IDs, send the array through the filtering function for each of
    // the header widgets, and each of the options menu widgets, then return the filtered array.
    DataGrid.prototype.applyAllWidgetFiltering = function (filteredSequence) {
        // Give each header widget a chance to apply filtering
        this._headerWidgets.forEach(function (widget) {
            filteredSequence = widget.applyFilterToIDs(filteredSequence);
        });
        // Give each widget in the options menu a chance to apply filtering
        this._optionsMenuWidgets.forEach(function (widget) {
            filteredSequence = widget.applyFilterToIDs(filteredSequence);
        });
        return filteredSequence;
    };
    // Add up all the column counts in the headerspec, to arrive at a grand total for the table.
    DataGrid.prototype.getSpec = function () {
        return this._spec; // F*** type conversion F*** things up when subclassing
    };
    // Add up all the column counts in the headerspec, to arrive at a grand total for the table.
    DataGrid.prototype.countTotalColumns = function () {
        return this._spec.tableHeaderSpec.reduce(function (prev, v) {
            if (v.headerRow) {
                if (v.headerRow > 1) {
                    return prev;
                }
            }
            return prev + (v.colspan ? v.colspan : 1);
        }, 0);
    };
    // Walk through each header in the spec, and look for a "sortBy" function.
    // If one is found, use it to construct a sorting function
    DataGrid.prototype._buildAllTableSorters = function () {
        var _this = this;
        this._spec.tableHeaderSpec.forEach(function (header) {
            if (header.sortBy) {
                header.sortFunc = _this.buildTableSorter(header.sortBy);
            }
        });
        return this;
    };
    // Given a comparison function,
    // construct a function suitable for passing to Javascript's "sort".
    DataGrid.prototype.buildTableSorter = function (lookupFunc) {
        var _this = this;
        return function (rowIndexA, rowIndexB) {
            var a = lookupFunc.call(_this._spec, rowIndexA);
            var b = lookupFunc.call(_this._spec, rowIndexB);
            return ((a > b) - (b > a)); // true becomes 1, false becomes 0
        };
    };
    // Start with the array of IDs given in the spec.  Then, for each header, build a sorted copy of the array,
    // and save the sorted copy into the header information.
    //
    // Some sort sequences may rely on the sort sequences of other headers.
    // In the code below, these are followed like a dependency tree.
    // We do this by tracking the unsorted headers in a set, and looping through the set.
    // Every time we find a header that we can successfully sort - whether because the prerequisite header is already
    // sorted, or because it has no prerequisite - we sort it and remove it from the set.
    // If we ever loop through the set and fail to remove even one item from it, we give up,
    // since there must be a dependency loop.
    // It's not the fastest method on the planet, but it's good enough, since we'll probably never have any more than 10 or so headers.
    DataGrid.prototype._buildTableSortSequences = function () {
        var _this = this;
        var unsortedHeaders = [];
        var sortedAtLeastOneNewHeader = false;
        // Declare all the headers unsorted, and add them to the unsorted set.
        this._spec.tableHeaderSpec.forEach(function (header) {
            if (header.sortFunc) {
                unsortedHeaders.unshift(header); // add in front, so set is reversed
                header.sorted = false;
                header.sortSequence = [];
                header.sortSequenceReversed = [];
            }
        });
        do {
            sortedAtLeastOneNewHeader = false;
            // use slice so that splice inside the callback does not interfere with loop
            unsortedHeaders.slice(0).forEach(function (header, index) {
                if (header.prerequisitesSorted(_this._spec)) {
                    header.initSortSequence(_this._spec);
                    header.sortSequence.sort(header.sortFunc);
                    // copy to new array via slice, then reverse sort
                    header.sortSequenceReversed = header.sortSequence.slice(0).reverse();
                    header.sorted = true;
                    unsortedHeaders.splice(index, 1);
                    sortedAtLeastOneNewHeader = true;
                }
            });
        } while (sortedAtLeastOneNewHeader);
        return this;
    };
    DataGrid.prototype._buildTableHeaders = function () {
        // Find the minimum number of rows we need to create to contain all the headers
        var maxheaderRow = this._spec.tableHeaderSpec.reduce(function (prev, v) {
            return Math.max(prev, v.headerRow || 0);
        }, 1);
        // Create enough rows to contain the headers (usually just 1)
        var rowElements = [];
        for (var i = 0; i < maxheaderRow; i++) {
            var row = $(document.createElement("tr")).addClass('columnLabels');
            rowElements.push(row[0]);
        }
        // Run through each individual header, create it according to the specs, and add it to the appropriate row.
        this._spec.tableHeaderSpec.forEach(function (header, i, src) {
            var commonCss = {
                'width': header.width ? (header.width.substr(-1) !== '%' ? header.width + 'px' : header.width) : undefined
            };
            var css = $.extend({
                'text-align': header.align,
                'vertical-align': header.valign,
                'display': header.display
            }, commonCss);
            header.element = document.createElement("th");
            var cell = $(header.element).css(css).attr({
                'id': header.id,
                'colspan': header.colspan > 1 ? header.colspan : undefined,
                'rowspan': header.rowspan > 1 ? header.rowspan : undefined,
                'class': header.size === 's' ? 'smaller' : undefined
            }).appendTo(rowElements[Math.max(header.headerRow || 1, 1) - 1]);
            if (header.sortBy) {
                cell.addClass('sortheader');
            }
            if (header.name) {
                $(document.createElement("div")).appendTo(cell).text(header.name).attr({ 'class': header.nowrap ? 'nowrap' : undefined }).css(commonCss);
            }
        });
        // Remove the right-side border line from the last element of each row
        rowElements.forEach(function (row) {
            var l = row.lastChild;
            if (l) {
                l.style.borderRight = '0';
            }
        });
        return rowElements;
    };
    // Build the rows (and the contents of the rows) for each record in the data.
    // (See the DataGridDataCell class.)
    DataGrid.prototype._allocateTableRowRecords = function () {
        var _this = this;
        this._recordElements = new DataGridRecordSet();
        this._spec.getRecordIDs().forEach(function (id) {
            _this._recordElements[id] = new DataGridRecord(_this._spec, id);
        });
        return this;
    };
    // Assemble table rows - disclosed and undisclosed versions (with callbacks) -
    // that act as titles for the different groups when the table is in grouping mode.
    DataGrid.prototype._buildRowGroupTitleRows = function () {
        var _this = this;
        this._spec.tableRowGroupSpec.forEach(function (oneGroup, index) {
            oneGroup.disclosed = true;
            oneGroup.memberRecords = [];
            var row = oneGroup.disclosedTitleRowJQ = $(oneGroup.disclosedTitleRow = document.createElement("tr")).addClass('groupHeader').click(function () { return _this._collapseRowGroup(index); });
            var cell = $(document.createElement("td")).appendTo(row);
            $(document.createElement("div")).appendTo(cell).text("\u25BA " + oneGroup.name);
            if (_this._totalColumnCount > 1) {
                cell.attr('colspan', _this._totalColumnCount);
            }
            row = oneGroup.undisclosedTitleRowJQ = $(oneGroup.undisclosedTitleRow = document.createElement("tr")).addClass('groupHeader').click(function () { return _this._expandRowGroup(index); });
            cell = $(document.createElement("td")).appendTo(row);
            $(document.createElement("div")).appendTo(cell).text("\u25BC " + oneGroup.name);
            if (_this._totalColumnCount > 1) {
                cell.attr('colspan', _this._totalColumnCount);
            }
        });
        return this;
    };
    // The server code hooks table headers with this function.
    DataGrid.prototype.clickedSort = function (header) {
        var _this = this;
        $(header.element).addClass('sortwait');
        // We turn the rest of the operation into an event so the browser
        // will (probably) refresh, showing our 'please wait' style
        this.scheduleTimer('_sortIt', function () { return _this._sortIt(header); });
    };
    // Handle the "sortable" CSS class in a table.
    DataGrid.prototype._prepareSortable = function () {
        var _this = this;
        // Add a click event for every header cell that identifies as sortable
        this._spec.tableHeaderSpec.forEach(function (header) {
            if (!header.sortBy) {
                return;
            }
            $(header.element).click(function () { return _this.clickedSort(header); });
        });
    };
    // Sort by a particular column.
    // thisth is the <th> element for the table header.
    // sameSortOrder is optional. If it's true, then we'll use the same sort order as thisth previously used.
    DataGrid.prototype._sortIt = function (header, sameSortOrder) {
        if (sameSortOrder === void 0) { sameSortOrder = false; }
        this._sortHeaderCurrent = header;
        // If we just sorted on this column, and reversesort has been defined but is zero,
        // do a reverse sort.
        if (sameSortOrder == false) {
            // if previous header and new header are same, flip the reversed flag
            if (this._sortHeaderPrevious == header) {
                header.sortCurrentlyReversed = !header.sortCurrentlyReversed;
            }
        }
        this.arrangeTableDataRows();
    };
    DataGrid.prototype._clickedOptMenuWhileOff = function () {
        $(this._optionsMenuBlockElement).add(this._optionsLabelOnElement).removeClass('off');
    };
    DataGrid.prototype._clickedOptMenuWhileOn = function () {
        $(this._optionsMenuBlockElement).add(this._optionsLabelOnElement).addClass('off');
    };
    DataGrid.prototype._collapseRowGroup = function (groupIndex) {
        var _this = this;
        var rowGroup = this._spec.tableRowGroupSpec[groupIndex];
        rowGroup.disclosed = false;
        this.scheduleTimer('arrangeTableDataRows', function () { return _this.arrangeTableDataRows(); });
    };
    DataGrid.prototype._expandRowGroup = function (groupIndex) {
        var _this = this;
        var rowGroup = this._spec.tableRowGroupSpec[groupIndex];
        rowGroup.disclosed = true;
        this.scheduleTimer('arrangeTableDataRows', function () { return _this.arrangeTableDataRows(); });
    };
    DataGrid.prototype.turnOnRowGrouping = function () {
        var _this = this;
        this._groupingEnabled = true;
        this.scheduleTimer('arrangeTableDataRows', function () { return _this.arrangeTableDataRows(); });
    };
    DataGrid.prototype.turnOffRowGrouping = function () {
        var _this = this;
        this._groupingEnabled = false;
        this.scheduleTimer('arrangeTableDataRows', function () { return _this.arrangeTableDataRows(); });
    };
    DataGrid.prototype.clickedOptionWidget = function (event) {
        var _this = this;
        var control = event.target; // Grab the checkbox that sent the event
        this.scheduleTimer('arrangeTableDataRows', function () { return _this.arrangeTableDataRows(); });
    };
    DataGrid.prototype.clickedHeaderWidget = function (headerWidget) {
        var _this = this;
        this.scheduleTimer('arrangeTableDataRows', function () { return _this.arrangeTableDataRows(); });
    };
    // 'control' is a column visibility checkbox
    DataGrid.prototype._clickedColVisibilityControl = function (event) {
        var control = event.target; // Grab the checkbox that sent the event
        // Acquire the value in a way that doesn't make Typescript throw a hissy-fit
        var val = parseInt(control.getAttribute('value'), 10) - 1;
        if (control.checked) {
            this.showColumn(val);
        }
        else {
            this.hideColumn(val);
        }
        return this;
    };
    // 'control' is a column visibility checkbox
    DataGrid.prototype.showColumn = function (columnIndex) {
        var _this = this;
        // The value points to an entry in the column groups specification
        if (!this._spec.tableColumnGroupSpec[columnIndex]) {
            return;
        }
        var group = this._spec.tableColumnGroupSpec[columnIndex];
        if (group.currentlyHidden) {
            group.currentlyHidden = false;
            if (group.revealedCallback) {
                group.revealedCallback(columnIndex, this._spec, this);
            }
            this.scheduleTimer('_updateColumnSettings', function () { return _this._updateColumnSettings(); });
            this.scheduleTimer('_applyColumnVisibility', function () { return _this._applyColumnVisibility(); });
        }
    };
    // 'control' is a column visibility checkbox
    DataGrid.prototype.hideColumn = function (columnIndex) {
        var _this = this;
        // The value points to an entry in the column groups specification
        if (!this._spec.tableColumnGroupSpec[columnIndex]) {
            return;
        }
        var group = this._spec.tableColumnGroupSpec[columnIndex];
        if (!group.currentlyHidden) {
            group.currentlyHidden = true;
            this.scheduleTimer('_updateColumnSettings', function () { return _this._updateColumnSettings(); });
            this.scheduleTimer('_applyColumnVisibility', function () { return _this._applyColumnVisibility(); });
        }
    };
    // The server binds this. 'this' is a checkbox.
    DataGrid.prototype._updateColumnSettings = function () {
        // Fetch the all-important pagename attribute
        var id = this._spec.tableSpec.id;
        // Build an AJAX URL containing the required action and the pagename
        var url = "PreferencesAjaxResp.cgi?action=_updateColumnSettings&pagename=" + encodeURIComponent(id);
        // Query every checkbox in the column visibility pulldown
        // and send its name and checked status back as part of the query.
        this._spec.tableColumnGroupSpec.forEach(function (group, index) {
            if (!group.showInVisibilityList || !group.checkboxElement) {
                return;
            }
            var j = group.checkboxElement;
            url += "&" + (index + 1) + "=" + encodeURIComponent(j.checked.toString());
        });
        $.ajax({
            url: url,
            dataTypeString: "json",
            success: function (data, textStatus, jqXHR) {
            }
        });
        return this;
    };
    // Schedule a call to the given function in the near future, and save the timer under the given identifier.
    // Multiple calls to this using the same identifier will reschedule the event, removing the old timer.
    DataGrid.prototype.scheduleTimer = function (uid, func) {
        if (this._timers[uid]) {
            clearTimeout(this._timers[uid]);
        }
        this._timers[uid] = setTimeout(func, 10);
        return this;
    };
    // apply a function to every record ID specified
    DataGrid.prototype.applyToRecordSet = function (func, ids) {
        var _this = this;
        ids.forEach(function (id) {
            func.call({}, _this._recordElements[id].getDataGridDataRows(), id, _this._spec, _this);
        });
        return this;
    };
    // retreive the current sequence of records in the DataGrid
    DataGrid.prototype.currentSequence = function () {
        var header = this._sortHeaderCurrent;
        return header.sortCurrentlyReversed ? header.sortSequenceReversed : header.sortSequence;
    };
    return DataGrid;
})();
// Type definition for the records contained in a DataGrid
var DataGridRecordSet = (function () {
    function DataGridRecordSet() {
    }
    return DataGridRecordSet;
})();
// Type definition for the records contained in a DataGrid
var DataGridRecord = (function () {
    function DataGridRecord(gridSpec, id) {
        this.gridSpec = gridSpec;
        this.recordID = id;
        this.rowElements = [];
        this.dataGridDataRows = [];
        this.stripeStyles = ['stripeRowA', 'stripeRowB'];
        this.stripeStylesJoin = this.stripeStyles.join(' ');
        this.createdElements = false;
        this.recentStripeIndex = null;
    }
    DataGridRecord.prototype.reCreateElementsInPlace = function () {
        // If the elements haven't been created even once, then divert to standard creation and finish.
        if (!this.createdElements) {
            this.createElements();
            return;
        }
        // If we're going to maintain the position of the new rows,
        // we need to find their earlier adjacent sibling, if one exists.
        var previousParent = null;
        var nextSibling = null;
        if (this.dataGridDataRows.length) {
            var lastEl = this.rowElements[this.dataGridDataRows.length - 1];
            // Sanity check:  Does it have a parent?  Can't have a valid sibling without a parent.
            if (lastEl.parentNode) {
                previousParent = lastEl.parentNode;
                nextSibling = lastEl.nextSibling;
            }
        }
        // Now that we know these things, we can ditch the rows out of the table.
        this.removeElements();
        // Force recreation.
        this.createdElements = false;
        // The old cells are still referenced in their colSpec objects before this,
        // but calling generateCells again automatically replaces them.
        this.createElements();
        // If recentStripeIndex is null, we haven't applied any striping to the previous row, so we skip it here.
        if (!(this.recentStripeIndex === null)) {
            this.applyStriping(this.recentStripeIndex);
        }
        // Drop the new rows into place where the old rows lived.
        if (previousParent) {
            if (nextSibling) {
                this.rowElements.forEach(function (row) {
                    previousParent.insertBefore(row, nextSibling);
                });
            }
            else {
                this.rowElements.forEach(function (row) {
                    previousParent.appendChild(row);
                });
            }
        }
    };
    DataGridRecord.prototype.createElements = function () {
        var _this = this;
        if (this.createdElements) {
            return;
        }
        this.rowElements = [];
        this.dataGridDataRows = [];
        var cellsForColumns = {};
        this.gridSpec.tableColumnSpec.forEach(function (colSpec, index) {
            cellsForColumns[index] = colSpec.generateCells(_this.gridSpec, _this.recordID);
        });
        // We will use these indexes to determine when we need to add the next cell, in the sequence of rows.
        var currentRowHeightsForColumns = {};
        this.gridSpec.tableColumnSpec.forEach(function (colSpec, index) {
            currentRowHeightsForColumns[index] = 0;
        });
        var addingForRow = 0;
        var moreToAdd = true;
        while (moreToAdd) {
            moreToAdd = false;
            var addingForColumn = 0;
            var cells = [];
            while (addingForColumn < this.gridSpec.tableColumnSpec.length) {
                if (currentRowHeightsForColumns[addingForColumn] > addingForRow) {
                    addingForColumn++;
                    continue;
                }
                var colCells = cellsForColumns[addingForColumn];
                var c = colCells.shift();
                // If there are still cells left to use, in any column, after drawing off the one
                // we're dealing with, then we should run through this loop again.
                if (colCells.length) {
                    moreToAdd = true;
                }
                var nextOpenColumn = addingForColumn + c.colspan;
                while (addingForColumn < nextOpenColumn) {
                    currentRowHeightsForColumns[addingForColumn] = addingForRow + c.rowspan;
                    addingForColumn++;
                }
                cells.push(c);
            }
            var r = new DataGridDataRow(this.recordID, cells);
            this.dataGridDataRows.push(r);
            this.rowElements.push(r.getElement());
            addingForRow++;
        }
        this.createdElements = true;
    };
    DataGridRecord.prototype.removeElements = function () {
        this.dataGridDataRows.forEach(function (row) {
            row.removeElement();
        });
    };
    // Like remove, except it doesn't remove JQuery events or data.
    // Used to take the table rows temporarily out of the DOM, like when re-ordering.
    DataGridRecord.prototype.detachElements = function () {
        this.dataGridDataRows.forEach(function (row) {
            row.detachElement();
        });
    };
    DataGridRecord.prototype.getDataGridDataRows = function () {
        if (!this.createdElements) {
            this.createElements();
        }
        return this.dataGridDataRows;
    };
    DataGridRecord.prototype.getElements = function () {
        if (!this.createdElements) {
            this.createElements();
        }
        return this.rowElements;
    };
    DataGridRecord.prototype.applyStriping = function (stripeIndex) {
        var _this = this;
        var rows = this.getDataGridDataRows();
        this.recentStripeIndex = stripeIndex;
        rows.forEach(function (row) {
            var rJQ = row.getElementJQ();
            rJQ.removeClass(_this.stripeStylesJoin).addClass(_this.stripeStyles[stripeIndex]);
        });
    };
    return DataGridRecord;
})();
// Container class for data rows in the body of the DataGrid table.
// DataGrid instantiates these by passing in an array of the DataGridDataCell objects that will form the content of the row.
var DataGridDataRow = (function () {
    function DataGridDataRow(id, cells) {
        this.recordID = id;
        this.dataGridDataCells = cells;
        this.createdElement = false;
    }
    DataGridDataRow.prototype.createElement = function () {
        var rowEl = document.createElement("tr");
        for (var i = 0; i < this.dataGridDataCells.length; i++) {
            var c = this.dataGridDataCells[i];
            rowEl.appendChild(c.getElement());
        }
        this.rowElement = rowEl;
        this.createdElement = true;
    };
    DataGridDataRow.prototype.removeElement = function () {
        if (this.createdElement) {
            this.getElementJQ().remove();
        }
    };
    // Like remove, except it doesn't remove JQuery events or data.
    // Used to take the table rows temporarily out of the DOM, like when re-ordering.
    DataGridDataRow.prototype.detachElement = function () {
        if (this.createdElement) {
            this.getElementJQ().detach();
        }
    };
    DataGridDataRow.prototype.getElement = function () {
        if (!this.createdElement) {
            this.createElement();
        }
        return this.rowElement;
    };
    DataGridDataRow.prototype.getElementJQ = function () {
        if (!this.createdElement) {
            this.createElement();
        }
        if (!this.rowElementJQ) {
            this.rowElementJQ = $(this.rowElement);
        }
        return this.rowElementJQ;
    };
    return DataGridDataRow;
})();
// Container class for cells in the body of the DataGrid table.
// DataGrid calls a function defined in DataGridColumnSpec objects to instantiate these,
// passing in a reference to the DataGridSpecBase and a unique identifier for a data record.
var DataGridDataCell = (function () {
    function DataGridDataCell(gridSpec, id, opt) {
        this.gridSpec = gridSpec;
        this.recordID = id;
        this.hidden = false;
        this.createdElement = false;
        this.contentFunction = opt['contentFunction'] || function (e, index) {
        };
        this.contentString = opt['contentString'] || '';
        opt = $.extend({ 'align': 'left' }, opt);
        this.rowspan = opt['rowspan'] || 1;
        this.colspan = opt['colspan'] || 1;
        this.align = opt['align'];
        this.valign = opt['valign'];
        this.maxWidth = opt['maxWidth'];
        this.minWidth = opt['minWidth'];
        this.nowrap = opt['nowrap'];
        this.hoverEffect = opt['hoverEffect'];
        this.checkboxWithID = opt['checkboxWithID'];
        this.customID = opt['customID'];
        this.sideMenuItems = opt['sideMenuItems'];
    }
    DataGridDataCell.prototype.createElement = function () {
        var id = this.recordID;
        var c = document.createElement("td");
        // If we're adding a checkbox on the left, or a popup side-menu on the right,
        // we need to create a sequence of divs as a scaffolding.
        if (this.checkboxWithID || this.sideMenuItems) {
            // td > div.p
            var dp = document.createElement("div");
            dp.className = 'p';
            c.appendChild(dp);
            // td > div.p > div.q
            var dq = document.createElement("div");
            dq.className = 'q';
            dp.appendChild(dq);
            if (this.checkboxWithID) {
                // td > div.p > div.q > div.r.checkbox
                var dr = document.createElement("div");
                dr.className = 'r checkbox';
                dq.appendChild(dr);
                // td > div.p > div.q > div.r.checkbox > input[checkbox]
                var cbID = this.checkboxWithID.call(this.gridSpec, id);
                var cb = document.createElement("input");
                cb.setAttribute('type', 'checkbox');
                cb.setAttribute('name', cbID);
                cb.setAttribute('id', cbID);
                cb.setAttribute('value', id.toString());
                this.checkboxElement = cb;
                dr.appendChild(cb);
            }
            // td > div.p > div.q > div.r
            var dr = document.createElement("div");
            dr.className = 'r';
            dq.appendChild(dr);
            if (this.sideMenuItems) {
                var mItems = this.sideMenuItems;
                if (mItems.length) {
                    // td > div.p > div.q > div.s
                    var ds = document.createElement("div");
                    ds.className = 's';
                    dq.appendChild(ds);
                    // td > div.p > div.q > div.s > div.t
                    var dt = document.createElement("div");
                    dt.className = 't';
                    ds.appendChild(dt);
                    // td > div.p > div.q > div.s > div.t > ul
                    var ul = document.createElement("ul");
                    dt.appendChild(ul);
                    for (var i = 0; i < mItems.length; i++) {
                        // td > div.p > div.q > div.s > div.t > ul > li
                        var li = document.createElement("li");
                        li.innerHTML = mItems[i];
                        ul.appendChild(li);
                    }
                }
            }
            this.contentContainerElement = dr;
        }
        else {
            // If we're not adding a checkbox or a side menu, construction is a lot easier...
            this.contentContainerElement = c;
        }
        this.contentContainerElement.innerHTML = this.contentString;
        this.contentFunction.call(this.gridSpec, this.contentContainerElement, id);
        var cellClasses = [];
        if (this.colspan > 1) {
            c.setAttribute('colspan', this.colspan.toString(10));
        }
        if (this.rowspan > 1) {
            c.setAttribute('rowspan', this.rowspan.toString(10));
        }
        if (this.customID) {
            c.setAttribute('id', this.customID.call(this.gridSpec, id));
        }
        if (this.hoverEffect) {
            cellClasses.push('popupcell');
        }
        if (this.nowrap) {
            cellClasses.push('nowrap');
        }
        if (this.minWidth) {
            c.style.minWidth = this.minWidth + 'px';
        }
        if (this.maxWidth) {
            c.style.maxWidth = this.maxWidth + 'px';
        }
        if (this.align) {
            c.style.textAlign = this.align;
        }
        if (this.valign) {
            c.style.verticalAlign = this.valign;
        }
        if (this.hidden) {
            cellClasses.push('off');
        }
        if (cellClasses.length > 0) {
            c.className = cellClasses.join(' ');
        }
        this.cellElement = c;
        this.cellElementJQ = $(c);
        if (this.hidden) {
            this.cellElementJQ.addClass('off');
        }
        this.createdElement = true;
    };
    DataGridDataCell.prototype.getElement = function () {
        if (!this.createdElement) {
            this.createElement();
        }
        return this.cellElement;
    };
    DataGridDataCell.prototype.getCheckboxElement = function () {
        if (!this.createdElement) {
            this.createElement();
        }
        return this.checkboxElement || null;
    };
    DataGridDataCell.prototype.hide = function () {
        if (!this.hidden) {
            if (this.createdElement) {
                this.cellElementJQ.addClass('off');
            }
            this.hidden = true;
        }
    };
    DataGridDataCell.prototype.unhide = function () {
        if (this.hidden) {
            if (this.createdElement) {
                this.cellElementJQ.removeClass('off');
            }
            this.hidden = false;
        }
    };
    return DataGridDataCell;
})();
// A general class that acts as a common repository for utility functions for DataGrid widgets.
// It is immediately subclassed into DataGridOptionWidget and DataGridHeaderWidget.
var DataGridWidget = (function () {
    function DataGridWidget(dataGridOwnerObject, dataGridSpec) {
        this.dataGridOwnerObject = dataGridOwnerObject;
        this.dataGridSpec = dataGridSpec;
    }
    // Utility function to create a label element
    DataGridWidget.prototype._createLabel = function (text, id) {
        var label = document.createElement("label");
        label.setAttribute('for', id);
        label.appendChild(document.createTextNode(text));
        return label;
    };
    // Utility function to create a checkbox element
    DataGridWidget.prototype._createCheckbox = function (id, name, value) {
        var cb = document.createElement("input");
        cb.setAttribute('id', id);
        cb.setAttribute('name', name);
        cb.setAttribute('type', 'checkbox');
        cb.setAttribute('value', value);
        return cb;
    };
    // This is called with an array of row elements, and the ID they represent, so the widget can
    //  apply any custom styling it needs. It is called one time for each ID and respective row
    //  array, during the construction of the table rows.
    DataGridWidget.prototype.initialFormatRowElementsForID = function (dataRowObjects, rowID) {
        // no special formatting by default
    };
    // Notify the widget that the DataGrid has been updated
    DataGridWidget.prototype.refreshWidget = function () {
        // nothing by default
    };
    return DataGridWidget;
})();
// This is the base class for additional widgets that appear in the options menu of a DataGrid table.
// The default behavior is to create a checkbox element with a callback, and pair it with a label element.
//
// Each DataGridOptionWidget needs to implement an applyFilterToIDs function to provide some method for filtering
// a given list of IDs.  This is how the widget affects which rows are displayed in the table.
//
// The DataGridSpec is responsible for instantiating these DataGridOptionWidget-derived objects for a particular table,
// and the DataGrid object is responsible for building the options menu that will store the checkbox and label elements.
var DataGridOptionWidget = (function (_super) {
    __extends(DataGridOptionWidget, _super);
    function DataGridOptionWidget(dataGridOwnerObject, dataGridSpec) {
        _super.call(this, dataGridOwnerObject, dataGridSpec);
        this._createdElements = false;
    }
    // The uniqueID is provided to assist the widget in avoiding collisions
    // when creating input element labels or other things requiring an ID.
    DataGridOptionWidget.prototype.createElements = function (uniqueID) {
        var _this = this;
        var cbID = this.dataGridSpec.tableSpec.id + 'GenericOptionCB' + uniqueID;
        var cb = this._createCheckbox(cbID, cbID, '1');
        // We need to make sure the checkbox has a callback to the DataGrid's handler function.
        // Among other things, the handler function will call the appropriate filtering functions for all the widgets in turn.
        $(cb).click(function (e) { return _this.dataGridOwnerObject.clickedOptionWidget(e); });
        if (this.isEnabledByDefault()) {
            cb.setAttribute('checked', 'checked');
        }
        this.checkBoxElement = cb;
        this.labelElement = this._createLabel("Name Of Option", cbID);
        this._createdElements = true;
    };
    // This is called to append the widget elements beneath the given element.
    // If the elements have not been created yet, they are created, and the uniqueID is passed along.
    DataGridOptionWidget.prototype.appendElements = function (container, uniqueID) {
        if (!this._createdElements) {
            this.createElements(uniqueID);
        }
        container.appendChild(this.checkBoxElement);
        container.appendChild(this.labelElement);
    };
    // This is called with an array of IDs for filtering, and a filtered array is returned.
    // It is acceptable to just return the original array if no filtering needs to be done.
    //
    // It's up to the designer to decide how the state of the widget affects filtering.
    // For example, if the widget is "additive", you would apply filtering if the widget's checkbox
    // is clear, and skip filtering if the checkbox is set, creating the appearance of a checkbox
    // that "adds" rows when checked.
    DataGridOptionWidget.prototype.applyFilterToIDs = function (rowIDs) {
        return rowIDs;
    };
    // Returns true if the control is enabled
    DataGridOptionWidget.prototype.getState = function () {
        return this.checkBoxElement.hasAttribute('checked');
    };
    // Returns true if the control should be enabled by default
    DataGridOptionWidget.prototype.isEnabledByDefault = function () {
        return false;
    };
    // Sets the enabled state to true or false, based on the given value
    DataGridOptionWidget.prototype.setState = function (enabled) {
        if (enabled) {
            this.checkBoxElement.setAttribute('checked', 'checked');
        }
        else {
            this.checkBoxElement.removeAttribute('checked');
        }
    };
    return DataGridOptionWidget;
})(DataGridWidget);
// This is the base class for additional widgets that appear in the header area of a DataGrid table.
//
// The DataGridSpec is responsible for instantiating these DataGridOptionWidget-derived objects for a particular table,
// and the DataGrid object is responsible for building the header area that will contain the widgets.
var DataGridHeaderWidget = (function (_super) {
    __extends(DataGridHeaderWidget, _super);
    function DataGridHeaderWidget(dataGridOwnerObject, dataGridSpec) {
        _super.call(this, dataGridOwnerObject, dataGridSpec);
        this._displayBeforeViewMenuFlag = false;
        this._createdElements = false;
    }
    // The uniqueID is provided to assist the widget in avoiding collisions
    // when creating input element labels or other things requiring an ID.
    DataGridHeaderWidget.prototype.createElements = function (uniqueID) {
        var tBoxID = this.dataGridSpec.tableSpec.id + 'text' + uniqueID;
        var tBox = $(this.element = document.createElement("input")).attr({ 'id': tBoxID, 'name': tBoxID, 'size': '20' }).addClass('tableControl');
    };
    // This is called to append the widget elements beneath the given element.
    // If the elements have not been created yet, they are created, and the uniqueID is passed along.
    DataGridHeaderWidget.prototype.appendElements = function (container, uniqueID) {
        if (!this._createdElements) {
            this.createElements(uniqueID);
            this.createdElements(true);
        }
        container.appendChild(this.element);
    };
    DataGridHeaderWidget.prototype.createdElements = function (flag) {
        if (flag === undefined) {
            return this._createdElements;
        }
        else {
            this._createdElements = flag;
            return this;
        }
    };
    DataGridHeaderWidget.prototype.displayBeforeViewMenu = function (flag) {
        if (flag === undefined) {
            return this._displayBeforeViewMenuFlag;
        }
        else {
            this._displayBeforeViewMenuFlag = flag;
            return this;
        }
    };
    // This is called with an array of record IDs for filtering, and a filtered array is returned.
    // It is acceptable to just return the original array if no record filtering needs to be done.
    DataGridHeaderWidget.prototype.applyFilterToIDs = function (rowIDs) {
        return rowIDs;
    };
    return DataGridHeaderWidget;
})(DataGridWidget);
// A generic "Select All" header widget, appearing as a button.
// When clicked, it walks through every row and cell looking for DataGrid-created checkboxes,
// and checks every one it finds.
var DGSelectAllWidget = (function (_super) {
    __extends(DGSelectAllWidget, _super);
    function DGSelectAllWidget(dataGridOwnerObject, dataGridSpec) {
        _super.call(this, dataGridOwnerObject, dataGridSpec);
    }
    // The uniqueID is provided to assist the widget in avoiding collisions
    // when creating input element labels or other things requiring an ID.
    DGSelectAllWidget.prototype.createElements = function (uniqueID) {
        var _this = this;
        var buttonID = this.dataGridSpec.tableSpec.id + 'SelAll' + uniqueID;
        var button = $(this.element = document.createElement("input"));
        button.attr({ 'id': buttonID, 'name': buttonID, 'value': 'Select All' }).addClass('tableControl').click(function () { return _this.clickHandler(); });
        this.element.setAttribute('type', 'button'); // JQuery attr cannot do this
    };
    DGSelectAllWidget.prototype.clickHandler = function () {
        var sequence = this.dataGridOwnerObject.currentSequence();
        // Have DataGrid apply function to everything in current sequence
        this.dataGridOwnerObject.applyToRecordSet(function (rows) {
            // each row in sequence
            rows.forEach(function (row) {
                // each cell in row
                row.dataGridDataCells.forEach(function (cell) {
                    // if the cell has a checkbox, check it
                    cell.checkboxElement && (cell.checkboxElement.checked = true);
                });
            });
        }, sequence);
    };
    return DGSelectAllWidget;
})(DataGridHeaderWidget);
// Here's an example of a working DataGridHeaderWidget.
// It's a search field that narrows the set of rows to ones that contain the given string.
var DGSearchWidget = (function (_super) {
    __extends(DGSearchWidget, _super);
    function DGSearchWidget(dataGridOwnerObject, dataGridSpec, placeHolder, size, getsFocus) {
        var _this = this;
        _super.call(this, dataGridOwnerObject, dataGridSpec);
        // (Note: This syntax causes "this" to behave in a non-Javascript way
        // see http://stackoverflow.com/questions/16157839/typescript-this-inside-a-class-method )
        this.typingDelayExpirationHandler = function () {
            // ignore if the following keys are pressed: [del] [shift] [capslock]
            //if (this.lastKeyPressCode == 46) {
            //	return;
            //}
            // ignore if the following keys are pressed: [del] [shift] [capslock]
            if (_this.lastKeyPressCode > 8 && _this.lastKeyPressCode < 32) {
                return;
            }
            var v = $(_this.element).val();
            if (v == _this.previousSelection) {
                return;
            }
            _this.previousSelection = v;
            _this.dataGridOwnerObject.clickedHeaderWidget(_this);
        };
        this.placeHolder = placeHolder;
        this.fieldSize = size;
        this.getsFocus = getsFocus;
        this.typingTimeout = null;
        this.typingDelay = 330;
        this.lastKeyPressCode = null;
        this.previousSelection = null;
        this.minCharsToTriggerSearch = 1;
    }
    // The uniqueID is provided to assist the widget in avoiding collisions
    // when creating input element labels or other things requiring an ID.
    DGSearchWidget.prototype.createElements = function (uniqueID) {
        var _this = this;
        var sBoxID = this.dataGridSpec.tableSpec.id + 'SearchBox' + uniqueID;
        var sBox = $(this.element = document.createElement("input")).attr({ 'id': sBoxID, 'name': sBoxID, 'size': this.fieldSize, 'placeholder': this.placeHolder }).addClass('tableControl searchBox').keydown(function (e) { return _this.inputKeyDownHandler(e); });
        this.element.setAttribute('type', 'text'); // JQuery .attr() cannot set this
        if (this.getsFocus) {
            sBox.attr('autofocus', 'autofocus');
        }
    };
    DGSearchWidget.prototype.inputKeyDownHandler = function (e) {
        // track last key pressed
        this.lastKeyPressCode = e.keyCode;
        switch (e.keyCode) {
            case 38:
                e.preventDefault();
                break;
            case 40:
                e.preventDefault();
                break;
            case 9:
                break;
            case 13:
                e.preventDefault();
                break;
            default:
                if (this.typingTimeout) {
                    clearTimeout(this.typingTimeout);
                }
                this.typingTimeout = setTimeout(this.typingDelayExpirationHandler, this.typingDelay);
                break;
        }
    };
    // This is called with an array of record IDs for filtering, and a filtered array is returned.
    // It is acceptable to just return the original array if no record filtering needs to be done.
    DGSearchWidget.prototype.applyFilterToIDs = function (rowIDs) {
        var v = this.previousSelection;
        if (v == null) {
            return rowIDs;
        }
        if (v.length < this.minCharsToTriggerSearch) {
            return rowIDs;
        }
        v = v.trim(); // Remove leading and trailing whitespace
        v = v.toLowerCase();
        v = v.replace(/\s\s*/, ' '); // Replace internal whitespace with single spaces
        // If there are multiple words, we match each separately.
        // We will not attempt to match against empty strings, so we filter those out if any slipped through
        var queryStrs = v.split(' ').filter(function (one) {
            return one.length > 0;
        });
        var filteredIDs = [];
        this.dataGridOwnerObject.applyToRecordSet(function (rows, id) {
            rows.forEach(function (row) {
                row.dataGridDataCells.forEach(function (cell) {
                    if (cell.createdElement) {
                        var text = cell.contentContainerElement.textContent.toLowerCase();
                        var match = queryStrs.some(function (v) {
                            // TODO: Sholdn't this be text.length >= v.length ?
                            return text.length > v.length && text.indexOf(v) >= 0;
                        });
                        if (match) {
                            filteredIDs.push(id);
                        }
                    }
                });
            });
        }, rowIDs);
        return filteredIDs;
    };
    return DGSearchWidget;
})(DataGridHeaderWidget);
// This is a widget that will place controls for paging
var DGPagingWidget = (function (_super) {
    __extends(DGPagingWidget, _super);
    function DGPagingWidget(dataGridOwnerObject, dataGridSpec, source) {
        var _this = this;
        _super.call(this, dataGridOwnerObject, dataGridSpec);
        this.requestDone = function (success) {
            if (success) {
                _this.dataGridOwnerObject.triggerDataReset();
            }
        };
        this.source = source;
        this.displayBeforeViewMenu(true);
    }
    // This is called to append the widget elements beneath the given element.
    // If the elements have not been created yet, they are created, and the uniqueID is passed along.
    DGPagingWidget.prototype.appendElements = function (container, uniqueID) {
        var _this = this;
        if (!this.createdElements()) {
            $(this.widgetElement = document.createElement('div')).appendTo(container);
            $(this.labelElement = document.createElement('span')).appendTo(this.widgetElement);
            $(this.prevElement = document.createElement('a')).attr('href', '#').css('margin', '0 5px').text('< Previous').prop('disabled', true).appendTo(this.widgetElement).click(function () {
                _this.source.pageDelta(-1).requestPageOfData(_this.requestDone);
                return false;
            });
            $(this.nextElement = document.createElement('a')).attr('href', '#').css('margin', '0 5px').text('Next >').prop('disabled', true).appendTo(this.widgetElement).click(function () {
                _this.source.pageDelta(1).requestPageOfData(_this.requestDone);
                return false;
            });
            this.createdElements(true);
        }
        this.refreshWidget();
    };
    DGPagingWidget.prototype.refreshWidget = function () {
        var totalSize = this.source.totalSize();
        var viewSize = this.source.viewSize();
        var start = this.source.totalOffset();
        var labelText;
        if (totalSize) {
            labelText = ['Displaying ', start + 1, '-', start + viewSize, ' of ', totalSize].join('');
        }
        else {
            labelText = 'No results found!';
        }
        $(this.labelElement).text(labelText);
        $(this.prevElement).prop('disabled', !start);
        $(this.nextElement).prop('disabled', start + viewSize >= totalSize);
    };
    return DGPagingWidget;
})(DataGridHeaderWidget);
// Define the TableSpec object used by DataGridSpecBase
var DataGridTableSpec = (function () {
    function DataGridTableSpec(id, opt) {
        this.id = id; // ID is required, initialize sensible defaults for everything else
        opt = $.extend({ 'name': '', 'defaultSort': 0, 'showHeader': true, 'applyStriping': true }, opt);
        this.name = opt['name'];
        this.defaultSort = opt['defaultSort'];
        this.showHeader = opt['showHeader'];
        this.applyStriping = opt['applyStriping'];
    }
    return DataGridTableSpec;
})();
// Define the HeaderSpec object used by DataGridSpecBase
var DataGridHeaderSpec = (function () {
    function DataGridHeaderSpec(group, id, opt) {
        this.columnGroup = group;
        this.id = id; // ID is required, initialize sensible defaults for everything else
        opt = $.extend({ 'name': '', 'align': 'left', 'size': 'm', 'sortAfter': -1 }, opt); // most things can be null
        this.name = opt['name'];
        this.align = opt['align'];
        this.valign = opt['valign'];
        this.nowrap = opt['nowrap'];
        this.rowspan = opt['rowspan'];
        this.colspan = opt['colspan'];
        this.headerRow = opt['headerRow'];
        this.display = opt['display'];
        this.size = opt['size'];
        this.width = opt['width'];
        this.sortBy = opt['sortBy'];
        this.sortAfter = opt['sortAfter'];
    }
    DataGridHeaderSpec.prototype.initSortSequence = function (spec) {
        if (this.sortAfter >= 0) {
            // if there is a prerequisite, init from its sort sequence
            this.sortSequence = spec.tableHeaderSpec[this.sortAfter].sortSequence.slice(0);
        }
        else {
            // otherwise go to the original source
            this.sortSequence = spec.getRecordIDs();
        }
        return this;
    };
    DataGridHeaderSpec.prototype.prerequisitesSorted = function (spec) {
        // make sure all prerequisites are sorted
        if (this.sortAfter >= 0) {
            return spec.tableHeaderSpec[this.sortAfter].sorted;
        }
        return true;
    };
    return DataGridHeaderSpec;
})();
// Define the ColumnSpec object used by DataGridSpecBase
var DataGridColumnSpec = (function () {
    function DataGridColumnSpec(group, generateCells) {
        this.columnGroup = group;
        this.generateCellsFunction = generateCells;
        this.createdDataCellObjects = {};
    }
    DataGridColumnSpec.prototype.generateCells = function (gridSpec, index) {
        var c = this.generateCellsFunction(gridSpec, index);
        this.createdDataCellObjects[index] = c.slice(0);
        return c;
    };
    DataGridColumnSpec.prototype.clearEntireIndex = function (index) {
        this.createdDataCellObjects = {};
    };
    DataGridColumnSpec.prototype.clearIndexAtID = function (index) {
        delete this.createdDataCellObjects[index];
    };
    DataGridColumnSpec.prototype.cellIndexAtID = function (index) {
        return this.createdDataCellObjects[index];
    };
    DataGridColumnSpec.prototype.getEntireIndex = function () {
        var cells = [];
        for (var key in this.createdDataCellObjects) {
            var a = this.createdDataCellObjects[key];
            if (a) {
                a.forEach(function (b) {
                    cells.push(b);
                }); // Much faster than repeated concats
            }
        }
        return cells;
    };
    return DataGridColumnSpec;
})();
// Define the ColumnGroupSpec object used by DataGridSpecBase
var DataGridColumnGroupSpec = (function () {
    function DataGridColumnGroupSpec(label, opt) {
        this.name = label;
        opt = $.extend({ 'showInVisibilityList': true }, opt);
        this.showInVisibilityList = opt['showInVisibilityList'];
        this.hiddenByDefault = opt['hiddenByDefault'];
        this.revealedCallback = opt['revealedCallback'];
    }
    return DataGridColumnGroupSpec;
})();
// Define the RowGroupSpec object used by DataGridSpecBase
var DataGridRowGroupSpec = (function () {
    function DataGridRowGroupSpec(label) {
        this.name = label;
    }
    return DataGridRowGroupSpec;
})();
// Users of DataGrid should derive from this class, altering the constructor to
// provide a specification for the layout, interface, and data sources of their DataGrid table,
// and override the callbacks to customize functionality.
// Then, when they instantiate a DataGrid, they should provide an instance of this derived DataGridSpacBase.
// As an example, this base class is set up to render the Studies table on the main page of the EDD.
var DataGridSpecBase = (function () {
    function DataGridSpecBase() {
        this.tableElement = this.getTableElement();
        this.tableSpec = this.defineTableSpec();
        this.tableHeaderSpec = this.defineHeaderSpec();
        this.tableColumnSpec = this.defineColumnSpec();
        this.tableColumnGroupSpec = this.defineColumnGroupSpec();
        this.tableRowGroupSpec = this.defineRowGroupSpec();
    }
    // All of these "define" functions should be overridden
    // Specification for the table as a whole
    DataGridSpecBase.prototype.defineTableSpec = function () {
        return new DataGridTableSpec('uniquestring', { 'name': 'Awesome Table' });
    };
    // Specification for the headers along the top of the table
    DataGridSpecBase.prototype.defineHeaderSpec = function () {
        return [
            new DataGridHeaderSpec(1, 'hName', { 'name': 'Name' }),
            new DataGridHeaderSpec(2, 'hDesc', { 'name': 'Description' })
        ];
    };
    // Specification for each of the data columns that will make up the body of the table
    DataGridSpecBase.prototype.defineColumnSpec = function () {
        return [
            new DataGridColumnSpec(1, function (gridSpec, index) {
                // Create cell(s) for a given record ID, for column 1
                return [new DataGridDataCell(gridSpec, index)];
            }),
            new DataGridColumnSpec(2, function (gridSpec, index) {
                // Create cell(s) for a given record ID, for column 2
                return [new DataGridDataCell(gridSpec, index)];
            }),
        ];
    };
    // Specification for each of the groups that the headers and data columns are organized into
    DataGridSpecBase.prototype.defineColumnGroupSpec = function () {
        return [
            new DataGridColumnGroupSpec('Name', { 'showInVisibilityList': false }),
            new DataGridColumnGroupSpec('Description')
        ];
    };
    // Specification for the groups that rows can be gathered into
    DataGridSpecBase.prototype.defineRowGroupSpec = function () {
        return [];
    };
    // When passed a record ID, returns the row group that the record is a member of.
    DataGridSpecBase.prototype.getRowGroupMembership = function (recordID) {
        return 0;
    };
    // The table element on the page that will be turned into the DataGrid.  Any preexisting table content will be removed.
    DataGridSpecBase.prototype.getTableElement = function () {
        return document.getElementById("studiesTable");
    };
    // An array of unique identifiers, used to identify the records in the data set being displayed
    DataGridSpecBase.prototype.getRecordIDs = function () {
        return [];
    };
    // This is called to generate the array of custom header widgets.
    // The order of the array will be the order they are added to the header bar.
    // It's perfectly fine to return an empty array.
    DataGridSpecBase.prototype.createCustomHeaderWidgets = function (dataGrid) {
        // Create a single widget for showing disabled Studies
        var array = [];
        array.push(new DGSearchWidget(dataGrid, this, 'Search Studies', 40, true));
        return array;
    };
    // This is called to generate the array of custom options menu widgets.
    // The order of the array will be the order they are displayed in the menu.
    // It's perfectly fine to return an empty array.
    DataGridSpecBase.prototype.createCustomOptionsWidgets = function (dataGrid) {
        var widgetSet = [];
        // Create a single widget for showing only the Studies that belong to the current user
        //		var onlyMyStudiesWidget = new DGOnlyMyStudiesWidget(dataGrid, this);
        //		widgetSet.push(onlyMyStudiesWidget);
        // Create a single widget for showing disabled Studies
        //		var disabledStudiesWidget = new DGDisabledStudiesWidget(dataGrid, this);
        //		widgetSet.push(disabledStudiesWidget);
        return widgetSet;
    };
    // This is called after everything is initialized, including the creation of the table content.
    DataGridSpecBase.prototype.onInitialized = function (dataGrid) {
        // Wire-in our custom edit fields for the Studies page
        IndexPage.initDescriptionEditFields();
    };
    // This is called when a data reset is triggered, but before the table rows are rebuilt.
    DataGridSpecBase.prototype.onDataReset = function (dataGrid) {
        return; // Do nothing by default.
    };
    // This is called when a partial data reset is triggered, but before the table rows are rebuilt.
    // A partial data reset is one where a collection of records have been specified for re-parsing,
    // and will be mixed-in with the currently rendered collection afterwards.
    DataGridSpecBase.prototype.onPartialDataReset = function (dataGrid, records) {
        return; // Do nothing by default.
    };
    // Called when the user hides or shows rows.
    DataGridSpecBase.prototype.onRowVisibilityChanged = function () {
    };
    // This is called to generate a group name. You can process your data however
    // you want in order to come up with a name.
    DataGridSpecBase.prototype.generateGroupName = function (dataGrid, groupID) {
        return "Group " + groupID;
    };
    // This is called when the grouping setting is changed, in case
    // you want to persist the setting somewhere.
    DataGridSpecBase.prototype.onUpdatedGroupingEnabled = function (dataGrid, enabled) {
    };
    return DataGridSpecBase;
})();
//# sourceMappingURL=DataGrid.js.map