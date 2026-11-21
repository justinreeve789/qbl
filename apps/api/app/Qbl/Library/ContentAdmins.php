<?php

namespace App\Qbl\Library;

use App\Qbl\Roles;
use App\Qbl\StoreError;
use PDO;

/**
 * Who the content admins are (App\Qbl\Roles::CONTENT_ADMIN): teachers who also edit every scenario
 * and manage the asset library. Administrators make them from the library's admin screen, or with
 * `php artisan qbl:update-role someone@school.org --role=content_admin`.
 */
class ContentAdmins
{
    public function __construct(private PDO $pdo) {}

    /** @return list<array{id: int, name: string, email: string, role: string}> */
    public function all(): array
    {
        $statement = $this->pdo->prepare('SELECT `id`, `name`, `email`, `role` FROM `users` WHERE `role` = ? ORDER BY `name`, `id`');
        $statement->execute([Roles::CONTENT_ADMIN]);

        return array_map(fn ($r) => ['id' => (int) $r['id']] + $r, $statement->fetchAll(PDO::FETCH_ASSOC));
    }

    /** Make the account with this address a content admin. Teachers and students can be; admins and guests not. */
    public function add(string $email): array
    {
        $email = strtolower(trim($email));
        $statement = $this->pdo->prepare('SELECT `id`, `role` FROM `users` WHERE LOWER(`email`) = ?');
        $statement->execute([$email]);
        $user = $statement->fetch(PDO::FETCH_ASSOC);
        if (! $user) {
            throw new StoreError(404, "There is no account with the address {$email}. They need to sign in once first.");
        }
        if ($user['role'] === Roles::ADMIN) {
            throw new StoreError(422, 'That account is an administrator, who can do all of this already.');
        }
        if ($user['role'] === Roles::GUEST) {
            throw new StoreError(422, 'A guest account cannot be given a role.');
        }
        $this->setRole((int) $user['id'], Roles::CONTENT_ADMIN);

        return $this->all();
    }

    /** Make a content admin a teacher again. */
    public function remove(int $userId): array
    {
        $statement = $this->pdo->prepare('SELECT `role` FROM `users` WHERE `id` = ?');
        $statement->execute([$userId]);
        if ($statement->fetchColumn() !== Roles::CONTENT_ADMIN) {
            throw new StoreError(404, 'That account is not a content admin.');
        }
        $this->setRole($userId, Roles::TEACHER);

        return $this->all();
    }

    private function setRole(int $userId, string $role): void
    {
        $this->pdo->prepare('UPDATE `users` SET `role` = ?, `updated_at` = ? WHERE `id` = ?')->execute([$role, gmdate('Y-m-d H:i:s'), $userId]);
    }
}
