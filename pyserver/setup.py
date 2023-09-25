from setuptools import setup, find_packages

setup(
    name = "tilemaptown_server",
    description = "Python server for 'TilemapTown'",
    packages=find_packages(),
    install_requires=["websockets", "aiohttp"],
    entry_points = {
        'console_scripts': ['tmtserver=tilemaptown_server.server:main'],
    },
    version = "0.2.0"
)
