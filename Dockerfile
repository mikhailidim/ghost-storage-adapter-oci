FROM ghost:6
LABEL name="ghost-oci"
LABEL maintainer="Michael Mikhailidi"
LABEL description="Ghost blog with Oracle Cloud Infrastructure storage adaptrer"
LABEL version="1.0"
LABEL org.opencontainers.image.authors="Michael Mikhailidi"
LABEL org.opencontainers.image.description="Ghost blog with Oracle Cloud Infrastructure storage adapter"
LABEL org.opencontainers.image.version="1.0"

# Use the official Ghost image as the base image

RUN set -eux; \
# save list of currently installed packages for later so we can clean up
	savedAptMark="$(apt-mark showmanual)"; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates gnupg wget curl; \
	rm -rf /var/lib/apt/lists/*; \
	\
	dpkgArch="$(dpkg --print-architecture | awk -F- '{ print $NF }')"; \
	wget -qO /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch"; \
	wget -qO /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch.asc"; 
# Copy the current directory contents into the container at /var/lib/ghost

RUN wget -qO /install.sh https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh; \
    chmod a+x /install.sh; \
    /install.sh --accept-all-defaults;
# Set up Ghost directory structure
COPY OciStorage.js /var/lib/ghost/current/core/server/adapters/storage/oci/OciStorage.js
COPY package.json /var/lib/ghost/current/core/server/adapters/storage/oci/package.json
WORKDIR /var/lib/ghost/current/core/server/adapters/storage/oci
RUN yarn install --production

WORKDIR /var/lib/ghost


