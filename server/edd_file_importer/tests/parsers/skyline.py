"""
Unit tests for Skyline file parsing.  These tests are all implemented using PyTest since there's no
need for database access.
"""

import json
import logging
import os
from typing import List
from uuid import uuid4

import pytest

import edd_file_importer.exceptions as exc
from edd_file_importer import parsers
from edd_file_importer.signals import warnings_reported

from ..test_utils import load_parse_record
from . import factory

logger = logging.getLogger(__name__)


def test_wrong_format():
    """
    Checks that missing required columns are correctly detected and that a helpful error
    message is created
    """
    text = ["Not,  The,  Right,   Format"]

    # invent a UUID for tracking messages in this workflow.  in context, this would
    # normally be an import UUID
    uuid = uuid4()

    parser = parsers.SkylineCsvParser(uuid)
    with pytest.raises(exc.RequiredColumnError) as exc_info:
        parser.parse(text)

    # compare expected vs actual error messages reported during the attempt
    assert exc_info.value.details == ["Replicate Name", "Protein Name", "Total Area"]


def test_duplicate_col():
    # invent a UUID for tracking messages in this workflow.  in context, this would
    # normally be an import UUID
    uuid = uuid4()

    text = ["Replicate Name, Protein Name, Peptide, Total Area, Total Area"]

    parser = parsers.SkylineCsvParser(uuid)
    with pytest.raises(exc.DuplicateColumnError) as exc_info:
        parser.parse(text)
    assert exc_info.value.details == ["D1", "E1"]


def test_missing_req_value():
    # invent a UUID for tracking messages in this workflow.  in context, this would
    # normally be an import UUID
    uuid = uuid4()

    text = [
        "Replicate Name, Protein Name, Peptide, Total Area",
        "arcA          , A           , Q      ,           ",
    ]
    parser = parsers.SkylineCsvParser(uuid)
    with pytest.raises(exc.RequiredValueError) as exc_info:
        parser.parse(text)

    value = exc_info.value
    assert value.subcategory == "Total Area"
    assert value.details == ["D2"]


def test_invalid_numeric_value():
    # invent a UUID for tracking messages in this workflow.  in context, this would
    # normally be an import UUID
    uuid = uuid4()

    text = [
        "Replicate Name, Protein Name, Peptide, Total Area",
        "arcA          , A           , Q      ,  Kitty    ",
    ]
    parser = parsers.SkylineCsvParser(uuid)
    with pytest.raises(exc.InvalidValueError) as exc_info:
        parser.parse(text)
    value = exc_info.value
    assert value.subcategory == "Total Area"
    assert value.details == ['"Kitty" (D2)']


def test_success_xlsx():
    """
    Verifies that a sample XLSX-format Skyline file can be successfully parsed, and that it
    produces identical results as when the same content is read from CSV file.
    """
    # invent a UUID for tracking messages in this workflow.  in context, this would normally be
    # an import UUID
    uuid = uuid4()

    file_path = factory.build_test_file_path("skyline", "skyline.xlsx")

    # parse the file
    parser = parsers.SkylineExcelParser(uuid)
    with open(file_path, "rb") as file:
        parsed = parser.parse(file)

    verify_parse_results(parsed)


def test_success_csv():
    """
    Verifies that a sample CSV-format Skyline file can be successfully parsed, and that it
    produces identical results as when the same content is read from XLSX file.
    """
    # invent a UUID for tracking messages in this workflow.  in context, this would normally be
    # an import UUID
    uuid = uuid4()

    file_path = factory.build_test_file_path("skyline", "skyline.csv")

    # parse the file
    parser = parsers.SkylineCsvParser(uuid)
    with open(file_path) as file:
        parsed = parser.parse(file)

    verify_parse_results(parsed)


def verify_parse_results(parsed: parsers.FileParseResult):
    """
    Utility method that compares parsed content from XLSX and CSV format Skyline files, verifying
    that: A) the results are correct, and B) that they're consistent regardless of which file
    format was used.
    :param parsed: parse results
    """
    # verify parse results
    assert parsed.any_time is False
    assert parsed.has_all_times is False
    assert parsed.has_all_units is True
    assert parsed.record_src == "row"
    assert parsed.line_or_assay_names == frozenset({"arcA", "BW1"})
    assert parsed.mtypes == {"A", "B", "C", "D"}
    record_count = sum(1 for _ in parsed.series_data)
    assert record_count == 7
    assert parsed.units == frozenset({"counts", "hours"})

    # compare MeasurementParseRecords generated by the parser
    test_file = os.path.join("skyline", "parse_result.json")
    with factory.load_test_file(test_file) as json_file:
        expected_dict = json.loads(json_file.read(), object_hook=load_parse_record)
        assert parsed.series_data == expected_dict


def test_warnings_xlsx():
    """
    Tests that a successful parse also detects and reports warnings.
    """
    # invent a UUID for tracking messages in this workflow.  in context, this would normally be
    # an import UUID
    uuid = str(uuid4())

    # set up a callback to track which warnings were reported via the "warnings_reported"
    # signal
    warnings: List[exc.EDDImportWarning] = []

    def warning_listener(sender, **kwargs):
        key = str(sender)
        logger.debug(f"warning_listener: {key}")  # TODO: remove debug stmt
        warns: exc.EDDImportWarning = kwargs["warns"]
        warnings.append(warns)

    warnings_reported.connect(warning_listener, sender=uuid, weak=False)

    file_path = factory.build_test_file_path("skyline", "skyline.xlsx")

    try:
        # parse the file
        parser = parsers.SkylineExcelParser(uuid)
        with open(file_path, "rb") as file:
            parser.parse(file)

        # test that warnings are being reported
        assert warnings == [
            exc.IgnoredWorksheetWarning(
                details=[
                    'Only the first sheet in your workbook, "Sheet 1", '
                    'was processed. The other sheet "Unused" was ignored.'
                ]
            ),
            exc.IgnoredColumnWarning(details=['"Unrecognized Header" (D2)']),
            exc.IgnoredValueWarning(details=['"Hand-scrawled research notes" (B1)']),
        ]
    finally:
        warnings_reported.disconnect(warning_listener, sender=uuid)