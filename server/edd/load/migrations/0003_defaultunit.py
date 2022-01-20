# Generated by Django 3.2.8 on 2021-10-22 21:52
from uuid import uuid4

import django.db.models.deletion
from django.db import migrations, models

import edd.fields


def bootstrap(apps, schema_editor):
    # create bootstrap objects
    Layout = apps.get_model("load", "Layout")
    LAYOUT_AMBR = Layout.objects.create(name="Ambr", description="")
    ParserMapping = apps.get_model("load", "ParserMapping")
    XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ParserMapping.objects.create(
        layout=LAYOUT_AMBR,
        mime_type=XLSX,
        parser_class="edd.load.parsers.AmbrExcelParser",
    )

    # create bootstrap objects -- MeasurementType, MeasurementUnit, DefaultUnit
    bootstrap_measurement_type_units_defaultunits(apps)
    # create bootstrap objects -- MeasurementNameTransform
    bootstrap_measurement_name_transform(apps)


def bootstrap_measurement_type_units_defaultunits(apps):
    MeasurementType = apps.get_model("main", "MeasurementType")
    MeasurementUnit = apps.get_model("main", "MeasurementUnit")
    DefaultUnit = apps.get_model("load", "DefaultUnit")
    # constants on main.models.MeasurementType.Group
    GENERIC = "_"
    METABOLITE = "m"

    C_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=GENERIC, unit_name="°C"
    )
    temperature_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Temperature", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(
        measurement_type=temperature_obj, unit=C_unit, parser="ambr"
    )

    rpm_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=GENERIC, unit_name="rpm"
    )
    stirspeed_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Stir speed", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(
        measurement_type=stirspeed_obj, unit=rpm_unit, parser="ambr"
    )

    na_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=METABOLITE, unit_name="n/a"
    )
    pH_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="pH", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=pH_obj, unit=na_unit, parser="ambr")

    lpm_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=GENERIC, unit_name="lpm"
    )
    airflow_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Air flow", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(
        measurement_type=airflow_obj, unit=lpm_unit, parser="ambr"
    )

    percent_max_mes_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=GENERIC, unit_name="% maximum measured"
    )
    DO_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Dissolved Oxygen", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(
        measurement_type=DO_obj, unit=percent_max_mes_unit, parser="ambr"
    )

    mM_L_h_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=GENERIC, unit_name="mM/L/h"
    )
    OUR_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="OUR", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(
        measurement_type=OUR_obj, unit=mM_L_h_unit, parser="ambr"
    )

    CER_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="CER", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(
        measurement_type=CER_obj, unit=mM_L_h_unit, parser="ambr"
    )

    RQ_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="RQ", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=RQ_obj, unit=na_unit, parser="ambr")

    mL_unit, _created = MeasurementUnit.objects.get_or_create(
        type_group=GENERIC, unit_name="mL"
    )
    fvp_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Feed volume pumped", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=fvp_obj, unit=mL_unit, parser="ambr")

    afvp_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC,
        type_name="Antifoam volume pumped",
        defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=afvp_obj, unit=mL_unit, parser="ambr")

    avp_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Acid volume pumped", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=avp_obj, unit=mL_unit, parser="ambr")

    bvp_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Base volume pumped", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=bvp_obj, unit=mL_unit, parser="ambr")

    vol_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Volume", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=vol_obj, unit=mL_unit, parser="ambr")

    vs_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Volume sampled", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=vs_obj, unit=mL_unit, parser="ambr")

    voi_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Volume of inocula", defaults={"uuid": uuid4()},
    )
    DefaultUnit.objects.create(measurement_type=voi_obj, unit=mL_unit, parser="ambr")


def bootstrap_measurement_name_transform(apps):
    MeasurementNameTransform = apps.get_model("load", "MeasurementNameTransform")
    MeasurementType = apps.get_model("main", "MeasurementType")

    GENERIC = "_"

    mes_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Dissolved Oxygen",
    )
    MeasurementNameTransform.objects.create(
        input_type_name="DO", edd_type_name=mes_obj, parser="ambr"
    )

    mes_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Feed volume pumped",
    )
    MeasurementNameTransform.objects.create(
        input_type_name="Feed#1 volume pumped", edd_type_name=mes_obj, parser="ambr"
    )

    mes_obj, _created = MeasurementType.objects.get_or_create(
        type_group=GENERIC, type_name="Volume sampled",
    )
    MeasurementNameTransform.objects.create(
        input_type_name="Volume - sampled", edd_type_name=mes_obj, parser="ambr"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("main", "0001_edd_2_7"),
        ("load", "0002_builtin_bootstrap"),
    ]

    operations = [
        migrations.CreateModel(
            name="MeasurementNameTransform",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "input_type_name",
                    edd.fields.VarCharField(
                        help_text="Name of this Measurement Type in input.",
                        verbose_name="Input Measurement Type",
                    ),
                ),
                ("parser", edd.fields.VarCharField(blank=True, null=True)),
                (
                    "edd_type_name",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="main.measurementtype",
                    ),
                ),
            ],
            options={"db_table": "measurement_name_transform"},
        ),
        migrations.CreateModel(
            name="DefaultUnit",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("parser", edd.fields.VarCharField(blank=True, null=True)),
                (
                    "measurement_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="main.measurementtype",
                    ),
                ),
                (
                    "protocol",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="main.protocol",
                    ),
                ),
                (
                    "unit",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="main.measurementunit",
                    ),
                ),
            ],
            options={"db_table": "default_unit"},
        ),
        migrations.RunPython(code=bootstrap, reverse_code=migrations.RunPython.noop),
    ]