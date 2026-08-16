import { getBrowserIdentity } from './browserIdentity'
import { supabase } from './lib/supabase'

let installed = false

function controllerLabel() {
  return getBrowserIdentity().displayName.trim() || 'Controller'
}

function withInsertIdentity(values: unknown) {
  const label = controllerLabel()
  if (Array.isArray(values)) {
    return values.map((value) =>
      value && typeof value === 'object'
        ? { ...value, created_by_label: label, updated_by_label: label }
        : value,
    )
  }
  if (values && typeof values === 'object') {
    return { ...values, created_by_label: label, updated_by_label: label }
  }
  return values
}

function withUpdateIdentity(values: unknown) {
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    return { ...values, updated_by_label: controllerLabel() }
  }
  return values
}

export function installAuditIdentity() {
  if (installed) return
  installed = true

  // Supabase's fluent builders are wrapped centrally so every current and future
  // write to arrivals carries the browser controller display name into the audit log.
  const client = supabase as any
  const originalFrom = client.from.bind(client)

  client.from = (relation: string) => {
    const builder = originalFrom(relation)
    if (relation !== 'arrivals') return builder

    return new Proxy(builder, {
      get(target, property, receiver) {
        if (property === 'insert') {
          return (values: unknown, options?: unknown) =>
            target.insert(withInsertIdentity(values), options)
        }

        if (property === 'update') {
          return (values: unknown, options?: unknown) =>
            target.update(withUpdateIdentity(values), options)
        }

        if (property === 'delete') {
          return (options?: unknown) => {
            const deleteBuilder = target.delete(options)
            return new Proxy(deleteBuilder, {
              get(deleteTarget, deleteProperty, deleteReceiver) {
                if (deleteProperty === 'eq') {
                  return async (column: string, value: unknown) => {
                    // The DELETE trigger can only see OLD. Stamp the actor first so the
                    // subsequent delete audit entry records the controller who clicked delete.
                    if (column === 'id') {
                      const { error: stampError } = await originalFrom('arrivals')
                        .update({ updated_by_label: controllerLabel() })
                        .eq(column, value)
                      if (stampError) return { data: null, error: stampError }
                    }
                    return deleteTarget.eq(column, value)
                  }
                }
                return Reflect.get(deleteTarget, deleteProperty, deleteReceiver)
              },
            })
          }
        }

        return Reflect.get(target, property, receiver)
      },
    })
  }
}
