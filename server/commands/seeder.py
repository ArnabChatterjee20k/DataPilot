from laserorm.storage.sqlite import SQLite
from laserorm.storage.storage import StorageSession
from laserorm.core.schema import Schema
from faker import Faker
from dataclasses import dataclass
import asyncio
import argparse
import random


@dataclass
class User(Schema):
    name: str
    location: list[float]


@dataclass
class Post(Schema):
    title: str
    user_id: int


fake = Faker()


def get_adapter(source: str):
    match source:
        case "sqlite":
            return SQLite("./seeder-db.db")


async def seed(session: StorageSession):
    await asyncio.gather(*(session.init_schema(model) for model in [User, Post]))

    for i in range(1, 1000):
        await asyncio.gather(
            session.create(
                User(
                    name=fake.name(),
                    location=[float(fake.latitude()), float(fake.longitude())],
                )
            ),
            session.create(Post(title=fake.sentence(), user_id=random.randint(1, i))),
        )


async def run(db):
    storage = get_adapter(db)
    async with storage.begin() as session:
        await seed(session)


parser = argparse.ArgumentParser()
parser.add_argument("--db", choices=["sqlite", "postgres"], required=True)
args = parser.parse_args()

asyncio.run(run(args.db))
