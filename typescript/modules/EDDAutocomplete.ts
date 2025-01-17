import "jquery";

import * as MultiColumnAuto from "./MultiColumnAutocomplete";

// track automatically generated caches for values in autocomplete types
const autoCache = {};

type GenericRecord = Record<string, any>;
type CacheKey = string | number;
type Cache = Record<CacheKey, GenericRecord>;

export interface AutocompleteOptions {
    // Mandatory: A JQuery object identifying the DOM element that contains, or will contain,
    // the input elements used by this autocomplete object.
    container: JQuery;

    // The JQuery object that uniquely identifies the visible autocomplete text input in the
    // DOM. This element will have the "autocomp" class added if not already present.
    // Note that when specifying this, the visibleInput must have an accompanying hiddenInput
    // specified which will be used to cache the selected value.
    // If neither of these values are supplied, both elements will be created and appended to
    // the container element.
    visibleInput?: JQuery;
    hiddenInput?: JQuery;

    // Optional form submission names to assign to the visible and hidden elements.
    // To the back end, the hiddenInput is generally the important one, so the option
    // for that is simply called 'name'.
    visibleInputName?: string;
    name?: string;

    // The string to show initially in the input element.
    // This may or may not be equivalent to a valid hiddenInput value.
    visibleValue?: string;

    // A starting value for hiddenInput.  This value is a unique identifier of some
    // back-end data structure - like a database record Id.
    // If this is provided but visibleValue is not, we attempt to generate an initial
    // visibleValue based on it.
    hiddenValue?: string;

    // Whether the field must have some value before submission (i.e. cannot be blank).
    // Default is false.
    nonEmptyRequired?: boolean; // TODO: Implement

    // Whether the field's contents must resolve to a valid Id before submission.
    // Default is usually true - it depends on the subclass.
    // Note that when nonEmptyRequired is false, a blank value is considered valid!
    validIdRequired?: boolean; // TODO: Implement

    // Whether a blank field defaults to show a "(Create New)" placeholder and submits
    // a hidden Id of 'new'.
    // Default is false.
    emptyCreatesNew?: boolean; // TODO: Implement

    // an optional dictionary to use / maintain as a cache of query results for this
    // autocomplete. Maps search term -> results.
    cache?: Cache;

    // the URI of the REST resource to use for querying autocomplete results
    search_uri?: string;
}

export interface ExtraSearchParameters {
    [param: string]: string;
}

export class BaseAuto {
    container: JQuery;
    visibleInput: JQuery;
    hiddenInput: JQuery;

    modelName: string;
    uid: number;

    opt: AutocompleteOptions;
    search_opt: ExtraSearchParameters;
    columns: MultiColumnAuto.AutoColumn[];
    display_key: string;
    value_key: string;
    cacheId: string;
    cache: Cache;
    search_uri: string;

    delete_last = false;

    static _uniqueIndex = 1;
    static _request_cache: { [name: string]: Cache } = {};

    static initPreexisting(context?: Element | JQuery): void {
        $("input.autocomp", context).each((i, element) => {
            const visibleInput: JQuery = $(element);
            const autocompleteType: string = $(element).attr("eddautocompletetype");
            if (!autocompleteType) {
                throw Error("eddautocompletetype must be defined!");
            }
            const opt: AutocompleteOptions = {
                "container": visibleInput.parent(),
                "visibleInput": visibleInput,
                "hiddenInput": visibleInput.next("input[type=hidden]"),
            };
            // This will automatically attach the created object to both input elements, in
            // the jQuery data interface, under the 'edd' object, attribute 'autocompleteobj'.
            const type_class = class_lookup[autocompleteType];
            const widget = new type_class(opt);
            widget.init();
        });
    }

    static create_autocomplete(container: JQuery): JQuery {
        const visibleInput = $('<input type="text"/>')
            .addClass("autocomp")
            .appendTo(container);
        $('<input type="hidden"/>').appendTo(container);
        return visibleInput;
    }

    static initial_search(auto: BaseAuto, term: string): void {
        const autoInput = auto.visibleInput;
        const oldResponse = autoInput.mcautocomplete("option", "response");
        autoInput.mcautocomplete("option", "response", function (ev, ui) {
            let highest = 0;
            let best;
            const termLower = term.toLowerCase();
            autoInput.mcautocomplete("option", "response", oldResponse);
            oldResponse.call({}, ev, ui);
            ui.content.every((item) => {
                if (item instanceof MultiColumnAuto.NonValueItem) {
                    return true;
                }
                const val = item[auto.display_key];
                const valLower = val.toLowerCase();
                if (val === term) {
                    best = item;
                    return false; // do not need to continue
                } else if (highest < 8 && valLower === termLower) {
                    highest = 8;
                    best = item;
                } else if (highest < 7 && valLower.indexOf(termLower) >= 0) {
                    highest = 7;
                    best = item;
                } else if (highest < 6 && termLower.indexOf(valLower) >= 0) {
                    highest = 6;
                    best = item;
                }
            });
            if (best) {
                autoInput
                    .mcautocomplete("instance")
                    ._trigger("select", "autocompleteselect", {
                        "item": best,
                    });
            }
        });
        autoInput.mcautocomplete("search", term);
        autoInput.mcautocomplete("close");
    }

    /**
     * Sets up the multicolumn autocomplete behavior for an existing text input. Must be
     * called after the $(window).load handler above.
     * @param opt a dictionary of settings following the AutocompleteOptions interface format.
     * @param search_options an optional dictionary of data to be sent to the search backend
     *     as part of the autocomplete search request.
     */
    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        const id = BaseAuto._uniqueIndex;
        BaseAuto._uniqueIndex += 1;
        this.uid = id;
        this.modelName = "Generic";

        this.opt = $.extend({}, opt);
        this.search_opt = $.extend({}, search_options);

        if (!this.opt.container) {
            throw Error("autocomplete options must specify a container");
        }
        this.container = this.opt.container;

        this.visibleInput =
            this.opt.visibleInput ||
            $('<input type="text"/>').addClass("autocomp").appendTo(this.container);
        this.hiddenInput =
            this.opt.hiddenInput ||
            $('<input type="hidden"/>').appendTo(this.container);
        if ("visibleValue" in this.opt) {
            this.visibleInput.val(this.opt.visibleValue);
        }
        if ("hiddenValue" in this.opt) {
            this.hiddenInput.val(this.opt.hiddenValue);
        }
        this.visibleInput.data("edd", { "autocompleteobj": this });
        this.hiddenInput.data("edd", { "autocompleteobj": this });

        this.display_key = "name";
        this.value_key = "id";
        this.search_uri = this.opt.search_uri || "/search/";

        // Static specification of column layout for each model in EDD that we want to
        // make searchable.  (This might be better done as a static JSON file
        // somewhere.)
        this.columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];
    }

    clear(): BaseAuto {
        const blank = this.opt.emptyCreatesNew ? "new" : "";
        this.hiddenInput.val(blank).trigger("change").trigger("input");
        return this;
    }

    init(): BaseAuto {
        // this.cacheId might have been set by a constructor in a subclass
        this.cacheId = this.cacheId || "cache_" + this.uid;
        this.cache =
            this.opt.cache || (autoCache[this.cacheId] = autoCache[this.cacheId] || {});

        // TODO add flag(s) to handle multiple inputs
        // TODO possibly also use something like https://github.com/xoxco/jQuery-Tags-Input
        this.visibleInput.addClass("autocomp");
        if (this.opt.emptyCreatesNew) {
            this.visibleInput.attr("placeholder", "(Create New)");
        }
        if (this.opt.visibleInputName) {
            this.visibleInput.attr("name", this.opt.visibleInputName);
        }
        if (this.opt.name) {
            this.hiddenInput.attr("name", this.opt.name);
        }

        this.visibleInput
            .mcautocomplete({
                // These next two options are what this plugin adds to the autocomplete widget.
                // FIXME these will need to vary depending on record type
                "showHeader": true,
                "columns": this.columns,
                // Event handler for when a list item is selected.
                "select": (event, ui) => {
                    let record, visibleValue, hiddenValue;
                    if (ui.item) {
                        record = this.loadRecord(ui.item);
                        this.visibleInput.val(
                            (visibleValue = this.loadDisplayValue(record)),
                        );
                        this.hiddenInput
                            .val((hiddenValue = this.loadHiddenValue(record)))
                            .trigger("change")
                            .trigger("input");
                        this.visibleInput.trigger("autochange", [
                            visibleValue,
                            hiddenValue,
                        ]);
                    }
                    return false;
                },
                "focus": (event, ui) => {
                    event.preventDefault();
                },
                "appendTo": "body",
                // The rest of the options are for configuring the ajax webservice call.
                "minLength": 0,
                "source": (request, response) => {
                    const termCachedResults = this.loadModelCache()[request.term];
                    if (termCachedResults) {
                        response(termCachedResults);
                        return;
                    }
                    $.ajax({
                        "url": this.search_uri,
                        "dataType": "json",
                        "data": $.extend(
                            {
                                "model": this.modelName,
                                "term": request.term,
                            },
                            this.search_opt,
                        ),
                        "success": this.processResults.bind(this, request, response),
                        "error": (jqXHR, status, err) => {
                            response([MultiColumnAuto.NonValueItem.ERROR]);
                        },
                    });
                },
                "search": (ev, ui) => {
                    $(ev.target).addClass("wait");
                },
                "response": (ev, ui) => {
                    $(ev.target).removeClass("wait");
                },
            })
            .on("blur", (ev) => {
                if (this.delete_last) {
                    // User cleared value in autocomplete, remove value from hidden ID
                    this.clear();
                } else {
                    // User modified value in autocomplete without selecting new one
                    // restore previous value
                    this.undo();
                }
                this.delete_last = false;
            })
            .on("keydown", (ev: JQueryKeyEventObject) => {
                // if the keydown ends up clearing the visible input, set flag
                const val = this.visibleInput.val().toString();
                this.delete_last = val.trim() === "";
            });
        return this;
    }

    loadDisplayValue(record: GenericRecord, defaultValue = ""): string {
        return record[this.display_key] || defaultValue;
    }

    loadHiddenValue(record: GenericRecord, defaultValue = ""): string {
        return record[this.value_key] || defaultValue;
    }

    loadModelCache(): Cache {
        const cache = BaseAuto._request_cache[this.modelName] || {};
        BaseAuto._request_cache[this.modelName] = cache;
        return cache;
    }

    loadRecord(item: GenericRecord): GenericRecord {
        const cacheKey = item[this.value_key];
        const record = (this.cache[cacheKey] = this.cache[cacheKey] || {});
        return Object.assign(record, item);
    }

    private processResults(request, response, data: any): void {
        const modelCache = this.loadModelCache();
        let result;
        // The default handler will display "No Results Found" if no items are returned.
        if (!data || !data.rows || data.rows.length === 0) {
            result = [MultiColumnAuto.NonValueItem.NO_RESULT];
        } else {
            // store returned results in cache
            result = data.rows;
            result.forEach((item) => {
                const cacheKey = item[this.value_key];
                const cacheRecord = this.cache[cacheKey] || {};
                this.cache[cacheKey] = cacheRecord;
                $.extend(cacheRecord, item);
            });
        }
        modelCache[request.term] = result;
        response(result);
    }

    undo(): BaseAuto {
        const old: any = this.cache[this.valKey()] || {};
        this.visibleInput.val(this.loadDisplayValue(old));
        return this;
    }

    val(): string {
        return this.hiddenInput.val() as string;
    }

    valKey(): CacheKey {
        // most autocompletes key values by integers
        return parseInt(this.val(), 10);
    }
}

// .autocomp_user
export class User extends BaseAuto {
    static columns = [
        new MultiColumnAuto.AutoColumn("User", "150px", "fullname"),
        new MultiColumnAuto.AutoColumn("Initials", "60px", "initials"),
        new MultiColumnAuto.AutoColumn("E-mail", "150px", "email"),
    ];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "User";
        this.columns = User.columns;
        this.display_key = "fullname";
        this.cacheId = "Users";
    }

    loadDisplayValue(record: GenericRecord, defaultValue = ""): string {
        const value = super.loadDisplayValue(record);
        if (value.trim() === "") {
            return record.email || defaultValue;
        } else {
            return value;
        }
    }
}

export class Group extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Group", "200px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "Group";
        this.columns = Group.columns;
        this.display_key = "name";
        this.cacheId = "Groups";
    }
}

// .autocomp_type
export class MetadataType extends BaseAuto {
    static columns = [
        new MultiColumnAuto.AutoColumn("Name", "200px", "name"),
        new MultiColumnAuto.AutoColumn("For", "50px", (item, column, index) => {
            const con = item.context;
            return $("<span>")
                .addClass("tag")
                .text(
                    con === "L"
                        ? "Line"
                        : con === "A"
                        ? "Assay"
                        : con === "S"
                        ? "Study"
                        : "?",
                );
        }),
    ];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "MetadataType";
        this.columns = MetadataType.columns;
        this.cacheId = "MetaDataTypes";
    }
}

// .autocomp_atype
export class AssayMetadataType extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "AssayMetadataType";
        this.columns = AssayMetadataType.columns;
        this.cacheId = "MetaDataTypes";
    }
}

// a special case autocomplete for use in the Assay creation / edit form.
// excludes types that map to Assay fields
export class AssayFormMetadataType extends AssayMetadataType {
    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        // default to sort by type name
        search_options = $.extend({ "sort": "type_name" }, search_options);
        super(opt, search_options);
        this.modelName = "AssayFormMetadataType";
    }
}

// .autocomp_altype
export class AssayLineMetadataType extends BaseAuto {
    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "AssayLineMetadataType";
        this.columns = MetadataType.columns;
        this.cacheId = "MetaDataTypes";
    }
}

// .autocomp_ltype
export class LineMetadataType extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "LineMetadataType";
        this.columns = LineMetadataType.columns;
        this.cacheId = "MetaDataTypes";
    }
}

// a special case autocomplete for use in the Line creation / edit form.  Specialized query
// parameters defined here work around inclusion of metadata types that replicate Line fields
// already included in the form. EDD-1131
export class LineFormMetadataType extends LineMetadataType {
    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        // default to sort by type name
        search_options = $.extend({ "sort": "type_name" }, search_options);
        super(opt, search_options);
        this.modelName = "LineFormMetadataType";
    }
}

// .autocomp_stype
export class StudyMetadataType extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "StudyMetadataType";
        this.columns = StudyMetadataType.columns;
        this.cacheId = "MetaDataTypes";
    }
}

// .autocomp_metabol
export class Metabolite extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "Metabolite";
        this.columns = Metabolite.columns;
        this.cacheId = "MetaboliteTypes";
        this.visibleInput.attr("size", 45);
    }
}

export class Protein extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "ProteinIdentifier";
        this.columns = Protein.columns;
        this.cacheId = "Proteins";
        this.visibleInput.attr("size", 45);
    }
}

export class Gene extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "GeneIdentifier";
        this.columns = Gene.columns;
        this.cacheId = "Genes";
        this.visibleInput.attr("size", 45);
    }
}

export class Phosphor extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "Phosphor";
        this.columns = Phosphor.columns;
        this.cacheId = "Phosphors";
        this.visibleInput.attr("size", 45);
    }
}

export class GenericOrMetabolite extends BaseAuto {
    static columns = [
        new MultiColumnAuto.AutoColumn("Name", "300px", "name"),
        new MultiColumnAuto.AutoColumn("Type", "100px", GenericOrMetabolite.type_label),
    ];
    static family_lookup = {
        "m": "Metabolite",
        "p": "Protein",
        "g": "Gene",
    };

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "GenericOrMetabolite";
        this.columns = GenericOrMetabolite.columns;
        this.cacheId = "GenericOrMetaboliteTypes";
        this.visibleInput.attr("size", 45);
    }

    static type_label(
        item: MeasurementTypeRecord,
        col: MultiColumnAuto.AutoColumn,
        i: number,
    ): string {
        const type_family = GenericOrMetabolite.family_lookup[item.family];
        if (type_family !== undefined) {
            return type_family;
        }
        return "Generic";
    }
}

// .autocomp_measure
export class MeasurementType extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "MeasurementType";
        this.columns = MeasurementType.columns;
        this.cacheId = "MeasurementTypes";
        this.visibleInput.attr("size", 45);
    }
}

export class MeasurementCompartment extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "200px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "MeasurementCompartment";
        this.columns = MeasurementCompartment.columns;
        this.cacheId = "MeasurementTypeCompartments";
        this.visibleInput.attr("size", 20);
    }
}

export class MeasurementUnit extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "150px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "MeasurementUnit";
        this.columns = MeasurementUnit.columns;
        this.cacheId = "UnitTypes";
        this.visibleInput.attr("size", 10);
    }
}

// .autocomp_sbml_r
export class MetaboliteExchange extends BaseAuto {
    static columns = [
        new MultiColumnAuto.AutoColumn("Exchange", "200px", "exchange"),
        new MultiColumnAuto.AutoColumn("Reactant", "200px", "reactant"),
    ];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "MetaboliteExchange";
        this.columns = MetaboliteExchange.columns;
        this.cacheId = "Exchange";
        this.display_key = "exchange";
        $.extend(this.search_opt, {
            "template": $(this.visibleInput).data("template"),
        });
    }
}

// .autocomp_sbml_s
export class MetaboliteSpecies extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "MetaboliteSpecies";
        this.columns = MetaboliteSpecies.columns;
        this.cacheId = "Species";
        $.extend(this.search_opt, {
            "template": $(this.visibleInput).data("template"),
        });
    }
}

export class StudyWritable extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "StudyWritable";
        this.columns = StudyWritable.columns;
        this.cacheId = "StudiesWritable";
    }
}

export class StudyLine extends BaseAuto {
    static columns = [new MultiColumnAuto.AutoColumn("Name", "300px", "name")];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "StudyLine";
        this.columns = StudyLine.columns;
        this.cacheId = "Lines";
    }
}

export class Registry extends BaseAuto {
    static columns = [
        new MultiColumnAuto.AutoColumn("Part ID", "100px", "partId"),
        new MultiColumnAuto.AutoColumn("Type", "100px", "type"),
        new MultiColumnAuto.AutoColumn("Name", "150px", "name"),
        new MultiColumnAuto.AutoColumn("Description", "250px", "shortDescription"),
    ];

    constructor(opt: AutocompleteOptions, search_options?: ExtraSearchParameters) {
        super(opt, search_options);
        this.modelName = "Registry";
        this.columns = Registry.columns;
        this.cacheId = "Registries";
        this.value_key = "recordId";
    }

    valKey(): any {
        // Registry autocompletes key values by UUID
        return this.val();
    }
}

/**
 * Adding this because looking up classes by name in the module no longer works correctly.
 * Where code was using:
 *    new EDDAuto[classname]()
 * Now it will use:
 *    new class_lookup[classname]()
 */
export const class_lookup: { [name: string]: typeof BaseAuto } = {
    "User": User,
    "Group": Group,
    "MetadataType": MetadataType,
    "AssayMetadataType": AssayMetadataType,
    "AssayFormMetadataType": AssayFormMetadataType,
    "AssayLineMetadataType": AssayLineMetadataType,
    "LineMetadataType": LineMetadataType,
    "LineFormMetadataType": LineFormMetadataType,
    "StudyMetadataType": StudyMetadataType,
    "Metabolite": Metabolite,
    "Protein": Protein,
    "Gene": Gene,
    "Phosphor": Phosphor,
    "GenericOrMetabolite": GenericOrMetabolite,
    "MeasurementType": MeasurementType,
    "MeasurementCompartment": MeasurementCompartment,
    "MeasurementUnit": MeasurementUnit,
    "MetaboliteExchange": MetaboliteExchange,
    "MetaboliteSpecies": MetaboliteSpecies,
    "StudyWritable": StudyWritable,
    "StudyLine": StudyLine,
    "Registry": Registry,
};
