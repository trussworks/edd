# coding: utf-8
from __future__ import unicode_literals

import logging

from builtins import str
from collections import OrderedDict
from django.db.models import Prefetch, Q
from django.utils.translation import ugettext_lazy as _


logger = logging.getLogger(__name__)


class ColumnChoice(object):
    def __init__(self, model, key, label, lookup, heading=None, lookup_kwargs={}):
        self._model = model
        self._key = u'.'.join([model.__name__, key, ])
        self._label = label
        self._lookup = lookup
        self._heading = heading if heading is not None else label
        self._lookup_kwargs = lookup_kwargs

    def get_field_choice(self):
        return (self._key, self._label)

    def get_heading(self):
        return self._heading

    def get_key(self):
        return self._key

    def get_value(self, instance):
        if instance is None:
            return ''
        return self._lookup(instance, **self._lookup_kwargs)


class EmptyChoice(ColumnChoice):
    """ Always inserts an empty value on lookup callback. """
    def __init__(self):
        super(EmptyChoice, self).__init__(str, '', '', lambda x: '')


class ExportSelection(object):
    """ Object used for selecting objects for export. """
    def __init__(self, user, studyId=[], lineId=[], assayId=[], measureId=[]):
        # cannot import these at top-level
        from main.models import Assay, CarbonSource, Line, Measurement, Strain, Study
        # check studies linked to incoming IDs for permissions
        matched_study = Study.objects.filter(
            Q(pk__in=studyId, active=True) |
            Q(line__in=lineId, line__active=True) |
            Q(line__assay__in=assayId, line__assay__active=True) |
            Q(line__assay__measurement__in=measureId, line__assay__measurement__active=True)
        ).distinct(
        ).prefetch_related(
            'userpermission_set',
            'grouppermission_set',
        )
        allowed_study = [s for s in matched_study if s.user_can_read(user)]
        # TODO: add in empty measurements for assays that have none
        # load all matching measurements
        self._measures = Measurement.objects.filter(
            # all measurements are from visible study
            Q(assay__line__study__in=allowed_study),
            # OR grouping finds measurements under one of passed-in parameters
            Q(assay__line__study__in=studyId) |
            Q(assay__line__in=lineId, assay__line__active=True) |
            Q(assay__in=assayId, assay__active=True) |
            Q(pk__in=measureId, active=True),
        ).order_by(
            'assay__protocol_id'
        ).select_related(
            'measurement_type',
            'x_units',
            'y_units',
            'update_ref__mod_by',
            'experimenter',
        )
        assays = Assay.objects.filter(
            Q(line__study__in=allowed_study),
            Q(line__in=lineId, line__active=True) |
            Q(pk__in=assayId, active=True) |
            Q(measurement__in=measureId, measurement__active=True),
        ).distinct(
        ).select_related(
            'protocol',
        )
        self._assays = {a.id: a for a in assays}
        lines = Line.objects.filter(
            Q(study__in=allowed_study),
            Q(study__in=studyId) |
            Q(pk__in=lineId, active=True) |
            Q(assay__in=assayId, assay__active=True) |
            Q(assay__measurement__in=measureId, assay__measurement__active=True),
        ).distinct(
        ).prefetch_related(
            Prefetch('strains', queryset=Strain.objects.order_by('id')),
            Prefetch('carbon_source', queryset=CarbonSource.objects.order_by('id')),
        )
        self._lines = {l.id: l for l in lines}
        self._studies = {s.id: s for s in allowed_study}

    @property
    def studies(self):
        """ A dict mapping Study.pk to Study for those studies included in the export and
            allowed to be viewed by the user. """
        return self._studies

    @property
    def study_columns(self):
        from main.models import Study
        return Study.export_columns(self._studies.values())

    @property
    def lines(self):
        """ A dict mapping Line.pk to Line for those lines included in the export. """
        return self._lines

    @property
    def line_columns(self):
        from main.models import Line
        return Line.export_columns(self._lines.values())

    @property
    def assays(self):
        """ A dict mapping Assay.pk to Assay for those assays included in the export. """
        return self._assays

    @property
    def assay_columns(self):
        from main.models import Assay
        return Assay.export_columns(self._assays.values())

    @property
    def measurements(self):
        """ A dict mapping Measurement.pk to Measurement for those measurements included in
            the export. """
        return self._measures


class ExportOption(object):
    """ Object used for options on a table export. """
    DATA_COLUMN_BY_LINE = 'dbyl'
    DATA_COLUMN_BY_POINT = 'dbyp'
    LINE_COLUMN_BY_DATA = 'lbyd'
    LAYOUT_CHOICE = (
        (DATA_COLUMN_BY_LINE, _('columns of metadata types, and rows of lines/assays')),
        (DATA_COLUMN_BY_POINT, _('columns of metadata types, and rows of single points')),
        (LINE_COLUMN_BY_DATA, _('columns of lines/assays, and rows of metadata types')),
    )
    COMMA_SEPARATED = 'csv'
    TAB_SEPARATED = 'tsv'
    SEPARATOR_CHOICE = (
        (COMMA_SEPARATED, _('Comma-separated (CSV)')),
        (TAB_SEPARATED, _('Tab-separated')),
    )
    ALL_DATA = 'all'
    SUMMARY_DATA = 'summary'
    NONE_DATA = 'none'
    FORMAT_CHOICE = (
        (ALL_DATA, _('All')),
        (SUMMARY_DATA, _('Summarize')),
        (NONE_DATA, _('None')),
    )

    def __init__(self, layout=DATA_COLUMN_BY_LINE, separator=COMMA_SEPARATED, data_format=ALL_DATA,
                 line_section=False, protocol_section=False, meta={}):
        self._layout = layout
        self._separator = separator
        self._data_format = data_format
        self._line_section = line_section
        self._protocol_section = protocol_section
        self._meta = meta

    @property
    def layout(self):
        return self._layout

    @property
    def separator(self):
        return self._separator

    @property
    def data_format(self):
        return self._data_format

    @property
    def line_section(self):
        return self._line_section

    @property
    def protocol_section(self):
        return self._protocol_section

    @property
    def study_meta(self):
        return self._meta.get('study_meta', [])

    @property
    def line_meta(self):
        return self._meta.get('line_meta', [])

    @property
    def protocol_meta(self):
        return self._meta.get('protocol_meta', [])

    @property
    def assay_meta(self):
        return self._meta.get('assay_meta', [])

    @property
    def measure_meta(self):
        return self._meta.get('measure_meta', [])


def value_str(value):
    """ used to format value lists to a colon-delimited (unicode) string """
    # cast to float to remove 0-padding
    return ':'.join(map(str, map(float, value)))


class TableExport(object):
    """ Outputs tables for export of EDD objects. """
    def __init__(self, selection, options, worklist=None):
        self.selection = selection
        self.options = options
        self.worklist = worklist
        self._x_values = {}

    def output(self):
        # check how tables are being sectioned
        line_section = self.options.line_section
        protocol_section = self.options.protocol_section
        # store tables
        tables = OrderedDict()
        if line_section:
            tables['line'] = OrderedDict()
            tables['line']['header'] = self._output_line_header()
        elif not protocol_section:
            tables['all'] = OrderedDict()
            tables['all']['header'] = self._output_line_header() + self._output_measure_header()
        if self.worklist and self.worklist['protocol']:
            self._do_worklist(tables)
        else:
            self._do_export(tables)
        return self._build_output(tables)

    def _build_output(self, tables):
        layout = self.options.layout
        table_separator = u'\n\n'
        row_separator = u'\n'
        cell_separator = u'\t' if self.options.separator == ExportOption.TAB_SEPARATED else u','
        if layout == ExportOption.DATA_COLUMN_BY_POINT:
            # data is already in correct orientation, join and return
            return table_separator.join([
                row_separator.join([
                    cell_separator.join([
                        str(cell) for cell in rrow
                        ]) for rkey, rrow in ttable.items()
                    ]) for tkey, ttable in tables.items()
                ])
        # both LINE_COLUMN_BY_DATA and DATA_COLUMN_BY_LINE are constructed similarly
        # each table in LINE_COLUMN_BY_DATA is transposed
        out = []
        for tkey, table in tables.items():
            # sort x values by original numeric values
            all_x = sorted(self._x_values.get(tkey, {}).items(), key=lambda a: a[1])
            # generate header row
            rows = [map(str, table['header'] + map(lambda x: x[0], all_x))]
            # go through non-header rows; unsquash final column
            for rkey, row in table.items()[1:]:
                unsquash = self._output_unsquash(all_x, row[-1:][0])
                rows.append(map(str, row[:-1] + unsquash))
            # do the transpose here if needed
            if layout == ExportOption.LINE_COLUMN_BY_DATA:
                rows = zip(*rows)
            # join the cells
            rows = [cell_separator.join(row) for row in rows]
            # join the rows
            out.append(row_separator.join(rows))
        return table_separator.join(out)

    def _do_export(self, tables):
        # add data from each exported measurement; already sorted by protocol
        for measurement in self.selection.measurements:
            assay = self.selection.assays.get(measurement.assay_id, None)
            protocol = assay.protocol
            line = self.selection.lines.get(assay.line_id, None)
            # build row with study/line info
            row = self._init_row_for_line(tables, line)
            # add on columns for protocol/assay/measurement
            row += self._output_measure_row(protocol, assay, measurement)
            table, table_key = self._init_tables_for_protocol(tables, protocol)
            values = measurement.measurementvalue_set.order_by('x')
            if self.options.layout == ExportOption.DATA_COLUMN_BY_POINT:
                for value in values:
                    arow = row[:]
                    arow.append(value_str(value.x))
                    arow.append(value_str(value.y))
                    table[value.id] = arow
            else:
                # keep track of all x values encountered in the table
                xx = self._x_values[table_key] = self._x_values.get(table_key, {})
                # do value_str to the float-casted version of x to eliminate 0-padding
                xx.update({value_str(v.x): v.x for v in values})
                squashed = {value_str(v.x): value_str(v.y) for v in values}
                row.append(squashed)
                table[measurement.id] = row

    def _do_worklist(self, tables):
        # if export is a worklist, go off of lines instead of measurements
        lines = self.selection.lines
        protocol = self.worklist['protocol']
        for pk, line in lines.items():
            # build row with study/line info
            row = self._init_row_for_line(tables, line)
            for space in self.worklist.get('placeholder', []):
                row.append(space)
            table, table_key = self._init_tables_for_protocol(tables, protocol)
            # append measurement type; insert empty cell if no types selected
            measurement_types = self.worklist.get('measurement_types', [])
            for m in measurement_types:
                temp = row[:] + self._output_measure_row(None, None, None)
                temp.append(m)
                table['%s.%s' % (pk, m)] = temp
            if not measurement_types:
                temp = row[:] + self._output_measure_row(None, None, None)
                temp.append('')
                table['%s' % (pk, )] = temp

    def _init_row_for_line(self, tables, line):
        line_section = self.options.line_section
        row = self._output_line_row(line.study, line)
        if line_section:
            if line.id not in tables['line']:
                tables['line'][line.id] = row
            # reset row after this point
            row = []
        return row

    def _init_tables_for_protocol(self, tables, protocol):
        if self.options.protocol_section:
            if protocol.id not in tables:
                tables[protocol.id] = OrderedDict()
                tables[protocol.id]['header'] = []
                if not self.options.line_section:
                    tables[protocol.id]['header'] += self._output_line_header()
                tables[protocol.id]['header'] += self._output_measure_header()
            table_key = protocol.id
        else:
            table_key = 'all'
        table = tables[table_key]
        return (table, table_key)

    def _output_line_header(self):
        row = []
        choices = {col.get_key(): col.get_heading() for col in self.selection.study_columns}
        for column in self.options.study_meta:
            row.append(choices.get(column, ''))
        choices = {col.get_key(): col.get_heading() for col in self.selection.line_columns}
        for column in self.options.line_meta:
            row.append(choices.get(column, ''))
        return row

    def _output_line_row(self, study, line):
        row = []
        empty = EmptyChoice()
        choices = {col.get_key(): col for col in self.selection.study_columns}
        for column in self.options.study_meta:
            row.append(choices.get(column, empty).get_value(study))
        choices = {col.get_key(): col for col in self.selection.line_columns}
        for column in self.options.line_meta:
            row.append(choices.get(column, empty).get_value(line))
        return row

    def _output_measure_header(self):
        from main.models import Measurement, MetadataTemplate, Protocol
        row = []
        choices = {col.get_key(): col.get_heading() for col in Protocol.export_columns()}
        for column in self.options.protocol_meta:
            row.append(choices.get(column, ''))
        choices = {col.get_key(): col.get_heading() for col in self.selection.assay_columns}
        for column in self.options.assay_meta:
            row.append(choices.get(column, ''))
        choices = {col.get_key(): col.get_heading() for col in Measurement.export_columns()}
        for column in self.options.measure_meta:
            row.append(choices.get(column, ''))
        # need to append measurement type columns for worklist output
        if self.worklist and self.worklist['protocol']:
            protocol = self.worklist['protocol']
            placeholder = []
            templates = MetadataTemplate.objects.filter(
                protocol=protocol,
            ).select_related(
                'meta_type',
            ).order_by(
                'ordering',
            )
            for meta in templates:
                row.append(meta.meta_type.type_name)
                placeholder.append(
                    meta.default_value if meta.default_value else meta.meta_type.default_value
                )
            self.worklist['placeholder'] = placeholder
            row.append(_('Measurement Type'))
        # need to append header columns for X, Y for tall-and-skinny output
        # others append all possible X values to header during o
        if self.options.layout == ExportOption.DATA_COLUMN_BY_POINT:
            row.append(_('X'))
            row.append(_('Y'))
        return row

    def _output_measure_row(self, protocol, assay, measure):
        from main.models import Measurement, Protocol
        row = []
        empty = EmptyChoice()
        choices = {col.get_key(): col for col in Protocol.export_columns()}
        for column in self.options.protocol_meta:
            row.append(choices.get(column, empty).get_value(protocol))
        choices = {col.get_key(): col for col in self.selection.assay_columns}
        for column in self.options.assay_meta:
            row.append(choices.get(column, empty).get_value(assay))
        choices = {col.get_key(): col for col in Measurement.export_columns()}
        for column in self.options.measure_meta:
            row.append(choices.get(column, empty).get_value(measure))
        return row

    def _output_unsquash(self, all_x, squashed):
        # all_x is list of 2-tuple from dict.items()
        if isinstance(squashed, dict):
            return map(lambda x: squashed.get(x[0], ''), all_x)
        # expecting a list to be returned
        return [squashed]
