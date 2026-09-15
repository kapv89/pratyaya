# Pratyaya demo

Try it here. Type a backtick and a `$` on an empty line below, then a `.`.

1. The `$.screens.Splash` screen
   1. Checks for a `$.components.PrivateKey`.
   2. If unauthenticated, redirects to the `$.screens.Login` screen.
2. The `$.screens.Login` screen
   1. On clicking the login button, goes to the `$.screens.NewUsername` screen.
3. The `$.screens.NewUsername` screen
   1. On a valid username, goes to the `$.screens.NewPrivateKey` screen.

Now type each of these on the empty lines below, and watch the suggestions:

- `` `$. ``            -> screens, components
- `` `$.screens. ``    -> Splash, Login, NewUsername, NewPrivateKey
- `` `$.screens.S ``   -> Splash
- `` `$.\.*$ ``         -> invalid, in red, and nothing can be applied
- `` `$->dump ``       -> the whole tree as JSON

Close a reference with a backtick once you have picked it: `` `$.screens.Splash` ``.




Definitions: put the cursor on the empty line below, type `` `$->define. `` and walk.



#### `$.screens.Splash`

The first screen the app shows. Checks for a `$.components.PrivateKey` and sends
the user to `$.screens.Login` or the dashboard.

---
