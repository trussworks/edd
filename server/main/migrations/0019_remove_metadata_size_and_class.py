# Generated by Django 2.2.3 on 2019-08-27 17:35

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [("main", "0018_provisional-types")]

    operations = [
        migrations.RemoveField(model_name="metadatatype", name="input_size"),
        migrations.RemoveField(model_name="metadatatype", name="type_class"),
    ]