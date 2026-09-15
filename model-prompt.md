# Specs

1. `$.screens.splash`
   1. Launched when:  
      1. The `$.apps.mobile-app` was launched from a previously unlaunched state. The app is by default
         behaving as a `$.nodes.ActorNode` unless changed post login to `$.nodes.replica-node`.
      2. The `$.apps.web-app` of a `$.nodes.ActorNode` is visited and the `$.apps.web-app` hasn't found an `$.auth.auth-token.web`.
      3. The `$.apps.desktop-app` is visited and the `$.storage.auth-cache.session` is empty. The app is by default behaving as a
         `$.nodes.ActorNode` unless changed post login to `$.nodes.replica-node`
   2. Checks for `$.actions.authentication`.  
      1. `$.actions.authentication` is checked by:  
         1. Existence of `$.auth.private-key`  
            1. If it exists, `$.actions.authentication` is considered successful.  
            2. If it doesn’t exist, `$.actions.authentication` is considered failed.  
      2. If `$.auth.state.unauthenticated`, redirects to the `$.screens.login-screen`.  
      3. If `$.auth.state.authenticated`, redirects to the `$.screens.master-dashboard`.  
2. `$.screens.login-screen`
   1. Shows a `$.ui.login-brand-banner` and a `$.ui.LoginButton`.  
   2. On clicking the `$.ui.LoginButton`, the app goes to the `$.screens.new-username`.  
3. The `$.screens.new-username` screen
   1. Shows an input where the user can input their username.  
   2. The username is alphanumeric without spaces.  
   3. On providing a valid username and clicking the submit button, the app goes to the `$.screens.new-private-key`.  
4. `$.screens.new-private-key`:
   1. Here the user is taken through the flow where they generate a new `$.auth.private-key`.  
   2. Additional safeguards like leveraging the (device|browser)’s key-vault for best security can be taken here.
   3. `$.agent.todo.auth`: Fill in the details.
   4. On successful generation of the private key, the app redirects to the `$.screens.master-dashboard`.
5. `$.screens.master-dashboard`
   1. `$.screens.master-dashboard` can be in one of the following states:
      1. There are no `$.entities.org` in the `$.storage.org-cache`.
         1. In this case, a `$.ui.no-org-component` is shown with the `$.ui.create-org-button`.
      2. There are `$.entities.org` objects in the `$.storage.org-cache`.
         1. In this case, the `$.ui.OrgCard` components are displayed, one for each org.
            1. The `$.ui.OrgCard` component contains the name of the org, the `$.auth.user`'s roles in the org.


#### `$.auth.auth-token.web`

This is the webapp's auth token for it's host `$.nodes.ActorNode`

---

#### `$.auth.private-key`

This is the private key of the device.

---

#### `$.nodes`

Nodes represent the devices which are running Kosh

---

#### `$.screens`

Screens are the screens that kosh as a software will have
