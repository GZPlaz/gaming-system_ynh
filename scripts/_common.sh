#!/bin/bash

# Copy the app code (kept in this repo under sources/) into the install dir
_bg_deploy_code() {
    mkdir -p "$install_dir"
    rm -rf "${install_dir:?}/www"
    cp -r "$YNH_APP_BASEDIR/sources/." "$install_dir/"
    chown -R "$app:$app" "$install_dir"
    chmod -R o-rwx "$install_dir"
}

_bg_fix_data_perms() {
    chown -R "$app:$app" "$data_dir"
    chmod -R o-rwx "$data_dir"
}
