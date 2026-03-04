container_name=$(basename $PWD)

podman run --rm -it \
    --name ${container_name} \
    -v $PWD:/mnt/${container_name} \
    $@ \
    kronik
