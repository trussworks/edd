# -*- coding: utf-8 -*-
# Generated by Django 1.9.4 on 2016-11-10 23:49
from __future__ import unicode_literals

from django.db import migrations
import main.models


def rearrange(apps, schema_editor):
    # current names with accession ID in type_name, shuffle to match:
    #   type_name = human-readable name; e.g. AATM_RABIT
    #   short_name = accession code ID portion; e.g. P12345
    #   accession_id = "full" accession ID if available; e.g. sp|P12345|AATM_RABIT
    #       if "full" version unavailable, repeat the short_name
    ProteinIdentifier = apps.get_model('main', 'ProteinIdentifier')
    for p in ProteinIdentifier.objects.all():
        match = main.models.ProteinIdentifier.accession_pattern.match(p.type_name)
        if match:
            p.accession_id = p.type_name
            if match.group(2):
                p.type_name = match.group(2)
            p.save()


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0023_add_uuid_and_slug'),
    ]

    operations = [
        migrations.AddField(
            model_name='proteinidentifier',
            name='accession_id',
            field=main.models.VarCharField(blank=True, null=True),
        ),

        # Move around data in any proteins with accession ID in the type_name
        migrations.RunPython(rearrange, reverse_code=migrations.RunPython.noop),
    ]
