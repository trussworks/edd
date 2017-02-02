# Experiment Data Depot

The Experiment Data Depot (EDD) is an online tool designed as a repository of standardized
biological experimental data and metadata. The EDD can easily uptake experimental data, provide
visualization of these data, and produce downloadable data in several standard output formats. See
the deployed version at [public-edd.jbei.org][1].

The EDD is available under a [BSD 3-Clause License][6] and is actively developed at the
[Lawrence Berkeley National Lab][7] (LBL) by the [Joint BioEnergy Institute][8] (JBEI), supported
by the U. S. Department of Energy (DOE), Office of Science, Office of Biological and Environmental
Research, through contract DE-AC02-05CH11231 between LBL and DOE.

The source code of EDD is published on [GitHub][9]. Pull requests should adhere to the
[Contributing Guidelines][10], and bug reports or feature requests should be directed to the GitHub
project.

## Contents

* [Getting Started](#Getting_Started)
* [Running EDD](#Running_EDD)
* [More Resources](#More_Resources)

---------------------------------------------------------------------------------------------------

## Getting Started <a name="#Getting_Started"/>

With [Docker][2] and [Docker Compose][3] installed, launching the entire EDD software stack is as
simple as copying the `docker_services` directory of the code repository and running:

    ./init-config.sh "Your Name" "youremail@example.com"
    docker-compose up -d

Without additional configuration, the launched copy of EDD will be using default options, so some
functions (e.g. TLS support, external authentication, referencing an ICE deployment) won't work.
See [Deployment][5] for more detailed instructions for installing Docker and configuring EDD for
your deployment environment.

---------------------------------------------------------------------------------------------------

## Running EDD <a name="#Running_EDD"/>

This section is a quick reference for commonly helpful commands for running / developing EDD. Many
of them use Docker Compose and other related Docker tools that aren't fully documented here.

* __Docker services__

  `docker-compose` is the recommended tool for controlling EDD services. `docker-compose.yml`
  defines the list of services as top-level entries under the 'services' line.

  For quick reference, the provided services are:
    * __edd__: runs initial startup tasks and prepares the other services
    * __appserver__: runs the EDD web application
    * __worker__: long-running and background tasks are run here with Celery
    * __postgres__: provides EDD's database
    * __redis__: provides the cache back-end for EDD
    * __solr__: provides a search index for EDD
    * __rabbitmq__: messaging bus that supports Celery
    * __flower__: management / monitoring application for Celery
    * __smtp__: mail server that supports emails from EDD
    * __nginx__: webserver that proxies clients' HTTP requests to other Docker services

  While edd is running, you can also get a list of its services by runnning `docker-compose ps`
  from the `docker_services` directory. Each container will be listed in the "Name" column of the
  output, with a name generated by Docker Compose. The name consists of three parts separated
  by underscores:
    * the "project", by default the current directory, may be set using the `-p` flag to
      `docker-compose` or the `COMPOSE_PROJECT_NAME` environment variable;
    * the "service" name;
    * a counter value, to distinguish multiple containers scaled beyond the first;
  As an example, the container named `edd_appserver_1` is the first instance of the `appserver`
  service in the `edd` project. You can also use `docker ps` from anywhere on the host to get a
  similar listing, though it will include all containers running on your host, not just those
  defined by EDD.

* __`docker-compose` commands__
    * Build all services: `docker-compose build`
    * Startup all services in detached mode: `docker-compose up -d` (recommended to keep muliple
      service logs from cluttering the screen, and so `^C` doesn't stop EDD)
    * View logs: `docker-compose logs [service]`
    * Bringing down all services: `docker-compose down`
    * See more in the [Docker Compose documentation][3]

* __Running multiple copies of EDD__

  If running multiple copies of EDD on one host, you _must_ use the `COMPOSE_PROJECT_NAME`
  environment variable or add the `-p` flag to every `docker-compose` command. Otherwise, each copy
  will create containers named similar to `dockerservices_edd_1`, because of the name of the
  `docker_services` subdirectory containing the Docker-related files. Commands intended for other
  copies will execute on the first launched copy, and not work as expected.

* __Determining the local URL for EDD's web interfaces:__

  If using a Linux host or Docker for Mac, use the hostname `localhost`. If using Docker Toolbox or
  docker-machine, use the hostname given by `docker-machine ip default`.
    * __EDD:__ `https://localhost/`
    * __EDD's REST API:__ `https://localhost/rest/` (if enabled)
    * __Solr:__ `https://localhost/solr/`
    * __Flower:__ `https://localhost/flower/`
    * __RabbitMQ Management Plugin:__ `https://localhost/rabbitmq/`

* __Interfacing with EDD's services from the command line:__
    * To run commands in __new__ containers, use `docker-compose run $SERVICE $COMMAND`,
      e.g.: `docker-compose run edd python manage.py shell`. Many Docker tutorals use "run" to
      simplify the directions, but it should generally be avoided since it creates new containers
      unnecessarily.
    * Run commands in __existing__ containers with `docker-compose exec $SERVICE $COMMAND`,
      e.g.: `docker-compose exec appserver python manage.py shell`
    * Restart misbehaving services with:  `docker-compose restart $SERVICE`
    * Other useful sample commands:
        * Connect to the Postgres command line: `docker-compose exec postgres psql -U postgres`
        * Connect to the Django shell: `docker-compose exec appserver python manage.py shell`

---------------------------------------------------------------------------------------------------

## More Resources <a name="#More_Resources"/>

For a more detailed reference for EDD's low-level configuration options, see [Configuration][4].
Instructions on administering an EDD instance can be found in the [Administration][11] document,
and steps to deploy a new instance are in the [Deployment][5] document. Getting a development
environment set up to modify or contribute to EDD is outlined in the [Developer Setup][12]
document.

---------------------------------------------------------------------------------------------------

[1]:    https://public-edd.jbei.org
[2]:    https://docker.io
[3]:    https://docs.docker.com/compose/overview/
[4]:    docs/Configuration.md
[5]:    docs/Deployment.md
[6]:    LICENSE.txt
[7]:    https://www.lbl.gov
[8]:    https://www.jbei.org
[9]:    https://github.com/JBEI/edd
[10]:   Contributing.md
[11]:   docs/Administration.md
[12]:   docs/Developer_Setup.md
