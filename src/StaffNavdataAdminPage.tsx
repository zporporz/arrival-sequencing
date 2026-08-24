import { useEffect } from 'react'
import StaffNavdataAdmin from './StaffNavdataAdmin'
import { installStaffNavdataDiffSummaryRuntime } from './staffNavdataDiffSummaryRuntime'
import { installStaffThailandNavdataImporterRuntime } from './staffThailandNavdataImporterRuntime'
import './staffNavdataAdmin.css'

export default function StaffNavdataAdminPage() {
  useEffect(() => {
    const removeDiffSummary = installStaffNavdataDiffSummaryRuntime()
    const removeThailandImporter = installStaffThailandNavdataImporterRuntime()
    return () => {
      removeDiffSummary()
      removeThailandImporter()
    }
  }, [])

  return <StaffNavdataAdmin />
}
